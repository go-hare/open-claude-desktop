/**
 * Official buddy BLE install residual (app.asar Bat / hlr / flr).
 *
 * - Bat(dir): top-level files only; e0e=18e5 total; name from basename or manifest.json.name
 * - flr: char_begin×8 → file → chunk base64 (t0e=256) → file_end (n===size) → char_end
 * - hlr: Bat + install-busy flag + flr
 *
 * Never invents upload success without real rm/Yq ack path.
 *
 * data-official-source: app.asar e0e / t0e / Bat / hlr / flr
 */

import fs from "node:fs/promises";
import path from "node:path";

/** Official e0e = 18e5 (1.8MB device folder limit). */
export const BUDDY_BLE_INSTALL_MAX_BYTES = 18e5;

/** Official t0e = 256 (chunk payload bytes before base64). */
export const BUDDY_BLE_INSTALL_CHUNK_BYTES = 256;

export type BuddyBleInstallFile = {
  name: string;
  size: number;
};

export type BuddyBleInstallInventory = {
  dir: string;
  name: string;
  totalBytes: number;
  files: BuddyBleInstallFile[];
};

export type BuddyBleInstallProgress = {
  file: string;
  bytesDone: number;
  bytesTotal: number;
};

export type BuddyBleInstallAck = {
  ok: boolean;
  n?: number;
  error?: unknown;
};

export type BuddyBleInstallRm = (
  line: string,
  ack: string,
  timeoutMs?: number,
) => Promise<BuddyBleInstallAck>;

/** Official progress line residual used by plr install sink. */
export function formatBuddyBleInstallProgressLine(
  p: BuddyBleInstallProgress,
): string {
  const pct = Math.round((p.bytesDone / Math.max(1, p.bytesTotal)) * 100);
  const kb = Math.round(p.bytesDone / 1024);
  return `uploading ${p.file} — ${pct}% (${kb}KB)`;
}

/** Official success line residual: ✓ sent ${name} (${kb}KB) */
export function formatBuddyBleInstallSentLine(
  name: string,
  bytes: number,
): string {
  return `✓ sent ${name} (${Math.round(bytes / 1024)}KB)`;
}

/** Official failure line residual: ✗ ${message} */
export function formatBuddyBleInstallFailLine(message: string): string {
  return `✗ ${message}`;
}

/**
 * Official Bat residual:
 *   readdir top-level files only (not recursive), skip dotfiles
 *   empty → "Folder is empty"
 *   total > e0e → "Folder is NKB; device limit is MKB"
 *   name = basename(dir) or manifest.json.name when present
 */
export async function inventoryBuddyBleInstallFolder(
  dir: string,
  opts?: { maxBytes?: number },
): Promise<BuddyBleInstallInventory> {
  const maxBytes = opts?.maxBytes ?? BUDDY_BLE_INSTALL_MAX_BYTES;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((o) => o.isFile() && !o.name.startsWith("."))
    .map((o) => o.name);
  if (names.length === 0) throw new Error("Folder is empty");

  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      size: (await fs.stat(path.join(dir, name))).size,
    })),
  );
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > maxBytes) {
    throw new Error(
      `Folder is ${Math.round(totalBytes / 1024)}KB; device limit is ${Math.round(maxBytes / 1024)}KB`,
    );
  }

  let name = path.basename(dir);
  if (names.includes("manifest.json")) {
    try {
      const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
      const o = JSON.parse(raw) as { name?: unknown };
      if (typeof o.name === "string" && o.name) name = o.name;
    } catch {
      /* keep basename */
    }
  }

  return { dir, name, totalBytes, files };
}

export function buildBuddyBleCharBeginCmd(
  name: string,
  total: number,
): string {
  return JSON.stringify({ cmd: "char_begin", name, total });
}

export function buildBuddyBleFileCmd(filePath: string, size: number): string {
  return JSON.stringify({ cmd: "file", path: filePath, size });
}

export function buildBuddyBleChunkCmd(data: Buffer): string {
  return JSON.stringify({ cmd: "chunk", d: data.toString("base64") });
}

export function buildBuddyBleFileEndCmd(): string {
  return JSON.stringify({ cmd: "file_end" });
}

export function buildBuddyBleCharEndCmd(): string {
  return JSON.stringify({ cmd: "char_end" });
}

/**
 * Official flr residual body — requires real rm ack function (no invent ok).
 */
export async function transferBuddyBleInstallResidual(
  inv: BuddyBleInstallInventory,
  rm: BuddyBleInstallRm,
  onProgress?: (p: BuddyBleInstallProgress) => void,
  opts?: { chunkBytes?: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const chunkBytes = opts?.chunkBytes ?? BUDDY_BLE_INSTALL_CHUNK_BYTES;
  const sleep =
    opts?.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let began = false;
  let beginError = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const res = await rm(
        buildBuddyBleCharBeginCmd(inv.name, inv.totalBytes),
        "char_begin",
        2_000,
      );
      if (res.ok) {
        began = true;
        break;
      }
      if (res.error) {
        beginError =
          typeof res.error === "string"
            ? res.error
            : String(res.error ?? "");
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(1_000);
  }
  if (!began) {
    throw new Error(beginError || "Stick did not respond to char_begin");
  }

  let bytesDone = 0;
  for (const file of inv.files) {
    const buf = await fs.readFile(path.join(inv.dir, file.name));
    const open = await rm(buildBuddyBleFileCmd(file.name, buf.length), "file");
    if (!open.ok) throw new Error(`Stick failed to open ${file.name}`);

    for (let offset = 0; offset < buf.length; offset += chunkBytes) {
      const slice = buf.subarray(
        offset,
        Math.min(offset + chunkBytes, buf.length),
      );
      const chunk = await rm(buildBuddyBleChunkCmd(slice), "chunk", 3_000);
      if (!chunk.ok) {
        throw new Error(`chunk failed at ${file.name}+${offset}`);
      }
      bytesDone += slice.length;
      onProgress?.({
        file: file.name,
        bytesDone,
        bytesTotal: inv.totalBytes,
      });
    }

    const end = await rm(buildBuddyBleFileEndCmd(), "file_end", 10_000);
    if (!end.ok || end.n !== buf.length) {
      throw new Error(
        `${file.name}: wrote ${end.n ?? 0} of ${buf.length}`,
      );
    }
  }

  const charEnd = await rm(buildBuddyBleCharEndCmd(), "char_end", 10_000);
  if (!charEnd.ok) {
    throw new Error("char_end failed — character did not reload");
  }
}

/**
 * Official hlr residual:
 *   inv = Bat(dir); Blr(); try flr finally Qlr; return {name,bytes}
 */
export async function runBuddyBleInstallResidual(
  dir: string,
  rm: BuddyBleInstallRm,
  onProgress?: (p: BuddyBleInstallProgress) => void,
  hooks?: {
    setInstallBusy?: (busy: boolean) => void;
    chunkBytes?: number;
    maxBytes?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ name: string; bytes: number }> {
  const inv = await inventoryBuddyBleInstallFolder(dir, {
    maxBytes: hooks?.maxBytes,
  });
  hooks?.setInstallBusy?.(true);
  try {
    await transferBuddyBleInstallResidual(inv, rm, onProgress, {
      chunkBytes: hooks?.chunkBytes,
      sleep: hooks?.sleep,
    });
  } finally {
    hooks?.setInstallBusy?.(false);
  }
  return { name: inv.name, bytes: inv.totalBytes };
}
