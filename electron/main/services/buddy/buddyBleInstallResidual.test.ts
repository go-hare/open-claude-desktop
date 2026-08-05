import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUDDY_BLE_INSTALL_CHUNK_BYTES,
  BUDDY_BLE_INSTALL_MAX_BYTES,
  buildBuddyBleCharBeginCmd,
  buildBuddyBleChunkCmd,
  buildBuddyBleFileCmd,
  formatBuddyBleInstallFailLine,
  formatBuddyBleInstallProgressLine,
  formatBuddyBleInstallSentLine,
  inventoryBuddyBleInstallFolder,
  runBuddyBleInstallResidual,
  transferBuddyBleInstallResidual,
  type BuddyBleInstallAck,
} from "./buddyBleInstallResidual";

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "buddy-install-"));
  tmpDirs.push(dir);
  return dir;
}

/** Size-aware rm mock: tracks last file open size for file_end n. */
function makeSizeAwareRm() {
  let openSize = 0;
  return vi.fn(
    async (
      line: string,
      _ack: string,
      _timeoutMs?: number,
    ): Promise<BuddyBleInstallAck> => {
      const msg = JSON.parse(line) as {
        cmd: string;
        size?: number;
      };
      if (msg.cmd === "file" && typeof msg.size === "number") {
        openSize = msg.size;
      }
      if (msg.cmd === "file_end") return { ok: true, n: openSize };
      return { ok: true };
    },
  );
}

afterEach(async () => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) await fs.rm(d, { recursive: true, force: true });
  }
});

describe("buddyBleInstallResidual", () => {
  it("exports official e0e/t0e constants", () => {
    expect(BUDDY_BLE_INSTALL_MAX_BYTES).toBe(18e5);
    expect(BUDDY_BLE_INSTALL_CHUNK_BYTES).toBe(256);
  });

  it("formats official progress / sent / fail lines", () => {
    expect(
      formatBuddyBleInstallProgressLine({
        file: "idle.gif",
        bytesDone: 512,
        bytesTotal: 1024,
      }),
    ).toBe("uploading idle.gif — 50% (1KB)");
    expect(formatBuddyBleInstallSentLine("buddy", 2048)).toBe(
      "✓ sent buddy (2KB)",
    );
    expect(formatBuddyBleInstallFailLine("nope")).toBe("✗ nope");
  });

  it("Bat inventory is flat-only with e0e limit and manifest name", async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, "a.txt"), "hello");
    await fs.mkdir(path.join(dir, "nested"));
    await fs.writeFile(path.join(dir, "nested", "deep.txt"), "nope");
    await fs.writeFile(path.join(dir, ".hidden"), "skip");
    await fs.writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({ name: "FromManifest" }),
    );

    const inv = await inventoryBuddyBleInstallFolder(dir);
    expect(inv.name).toBe("FromManifest");
    expect(inv.files.map((f) => f.name).sort()).toEqual([
      "a.txt",
      "manifest.json",
    ]);
    expect(inv.totalBytes).toBe(
      Buffer.byteLength("hello") +
        Buffer.byteLength(JSON.stringify({ name: "FromManifest" })),
    );

    const empty = await makeTmpDir();
    await expect(inventoryBuddyBleInstallFolder(empty)).rejects.toThrow(
      "Folder is empty",
    );

    const big = await makeTmpDir();
    await fs.writeFile(path.join(big, "big.bin"), Buffer.alloc(11 * 1024));
    await expect(
      inventoryBuddyBleInstallFolder(big, { maxBytes: 10 * 1024 }),
    ).rejects.toThrow(/device limit is 10KB/);
  });

  it("builds official install cmd lines", () => {
    expect(JSON.parse(buildBuddyBleCharBeginCmd("n", 100))).toEqual({
      cmd: "char_begin",
      name: "n",
      total: 100,
    });
    expect(JSON.parse(buildBuddyBleFileCmd("a.gif", 3))).toEqual({
      cmd: "file",
      path: "a.gif",
      size: 3,
    });
    const chunk = JSON.parse(buildBuddyBleChunkCmd(Buffer.from("ab")));
    expect(chunk.cmd).toBe("chunk");
    expect(chunk.d).toBe(Buffer.from("ab").toString("base64"));
  });

  it("flr sequence char_begin → file → chunk → file_end → char_end", async () => {
    const dir = await makeTmpDir();
    const payload = Buffer.alloc(300, 7); // > 256 → 2 chunks
    await fs.writeFile(path.join(dir, "frame.bin"), payload);

    const inv = await inventoryBuddyBleInstallFolder(dir);
    const calls: Array<{ line: string; ack: string; timeout?: number }> = [];
    const progress: Array<{ file: string; bytesDone: number }> = [];

    const rm = vi.fn(
      async (
        line: string,
        ack: string,
        timeoutMs?: number,
      ): Promise<BuddyBleInstallAck> => {
        calls.push({ line, ack, timeout: timeoutMs });
        const msg = JSON.parse(line) as { cmd: string; size?: number };
        if (msg.cmd === "file_end") return { ok: true, n: payload.length };
        if (msg.cmd === "file") return { ok: true };
        return { ok: true };
      },
    );

    await transferBuddyBleInstallResidual(
      inv,
      rm,
      (p) => {
        progress.push({ file: p.file, bytesDone: p.bytesDone });
      },
      { sleep: async () => undefined },
    );

    expect(calls.map((c) => c.ack)).toEqual([
      "char_begin",
      "file",
      "chunk",
      "chunk",
      "file_end",
      "char_end",
    ]);
    expect(calls[0]?.timeout).toBe(2_000);
    expect(calls.find((c) => c.ack === "chunk")?.timeout).toBe(3_000);
    expect(calls.find((c) => c.ack === "file_end")?.timeout).toBe(10_000);
    expect(progress.at(-1)).toEqual({
      file: "frame.bin",
      bytesDone: payload.length,
    });
  });

  it("char_begin retries then fail-closed; file_end n mismatch fails", async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(path.join(dir, "x.txt"), "hi");
    const inv = await inventoryBuddyBleInstallFolder(dir);

    let beginAttempts = 0;
    await expect(
      transferBuddyBleInstallResidual(
        inv,
        async () => {
          beginAttempts += 1;
          return { ok: false };
        },
        undefined,
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow("Stick did not respond to char_begin");
    expect(beginAttempts).toBe(8);

    await expect(
      transferBuddyBleInstallResidual(
        inv,
        async (_line, ack) => {
          if (ack === "file_end") return { ok: true, n: 0 };
          return { ok: true };
        },
        undefined,
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow(/wrote 0 of 2/);
  });

  it("hlr sets busy flag and returns name/bytes", async () => {
    const dir = await makeTmpDir();
    await fs.writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({ name: "StickChar" }),
    );
    await fs.writeFile(path.join(dir, "idle.txt"), "frame");

    const busy: boolean[] = [];
    const result = await runBuddyBleInstallResidual(
      dir,
      makeSizeAwareRm(),
      undefined,
      {
        setInstallBusy: (b) => busy.push(b),
        sleep: async () => undefined,
      },
    );

    expect(result.name).toBe("StickChar");
    expect(result.bytes).toBeGreaterThan(0);
    expect(busy).toEqual([true, false]);
  });
});
