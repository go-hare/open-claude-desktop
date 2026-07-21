#!/usr/bin/env node
/**
 * Official CDN residual probe (app.asar EGi / Hn.sha / rootfs.img.zst):
 *
 *   HEAD  https://downloads.claude.ai/vms/linux/<arch>/<Hn.sha>/rootfs.img.zst
 *   Range bytes=0-15 → expect zstd magic 28 b5 2f fd
 *
 * Does NOT download the full ~2 GiB rootfs. Use link residual or
 * ensureCoworkVmRootfs for full download when network + disk allow.
 *
 * Usage:
 *   node scripts/probe-cowork-vm-cdn.mjs
 *   node scripts/probe-cowork-vm-cdn.mjs --arch arm64
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Prefer compiled/ts path via dynamic import of source constants.
// Fall back to known official Hn.sha if module resolution fails in plain node.
const OFFICIAL_SHA_FALLBACK = "5680b11bcdab215cccf07e0c0bd1bd9213b0c25d";

function parseArgs(argv) {
  let arch = process.arch === "x64" ? "x64" : "arm64";
  let sha = OFFICIAL_SHA_FALLBACK;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--arch" && argv[i + 1]) {
      arch = argv[++i];
    } else if (argv[i] === "--sha" && argv[i + 1]) {
      sha = argv[++i];
    }
  }
  return { arch, sha };
}

async function loadSha() {
  try {
    // Built product may not expose TS; try package path via tsx/vitest not required.
    const modPath = path.join(
      root,
      "electron/main/services/coworkVm/coworkClaudeVm.ts",
    );
    // Best-effort: read COWORK_VM_BUNDLE_SHA from source text.
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(modPath, "utf8");
    const m = /COWORK_VM_BUNDLE_SHA\s*=\s*["']([0-9a-f]+)["']/.exec(src);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return OFFICIAL_SHA_FALLBACK;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sha = args.sha === OFFICIAL_SHA_FALLBACK ? await loadSha() : args.sha;
  const arch = args.arch === "x64" || args.arch === "arm64" ? args.arch : "arm64";
  const base = `https://downloads.claude.ai/vms/linux/${arch}/${sha}`;
  const url = `${base}/rootfs.img.zst`;

  console.log(`[probe-cowork-vm-cdn] HEAD ${url}`);
  const head = await fetch(url, { method: "HEAD" });
  const contentType = head.headers.get("content-type");
  const contentLength = head.headers.get("content-length");
  console.log(
    JSON.stringify(
      {
        stage: "HEAD",
        status: head.status,
        ok: head.ok,
        contentType,
        contentLength,
      },
      null,
      2,
    ),
  );
  if (!head.ok) {
    process.exitCode = 1;
    return;
  }

  console.log(`[probe-cowork-vm-cdn] Range 0-15 ${url}`);
  const range = await fetch(url, {
    headers: { Range: "bytes=0-15" },
  });
  const buf = Buffer.from(await range.arrayBuffer());
  const magic = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0"));
  const zstdOk =
    buf.length >= 4
    && buf[0] === 0x28
    && buf[1] === 0xb5
    && buf[2] === 0x2f
    && buf[3] === 0xfd;
  console.log(
    JSON.stringify(
      {
        stage: "Range",
        status: range.status,
        ok: range.ok || range.status === 206,
        bytes: buf.length,
        magic,
        zstdMagic: zstdOk,
      },
      null,
      2,
    ),
  );
  if (!(range.ok || range.status === 206) || !zstdOk) {
    process.exitCode = 1;
    return;
  }
  console.log("[probe-cowork-vm-cdn] PASS (HEAD + zstd magic). Full download not performed.");
}

main().catch((error) => {
  console.error("[probe-cowork-vm-cdn] FAIL", error);
  process.exitCode = 1;
});
