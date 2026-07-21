/**
 * Official downloadVM residual (app.asar QGi / EGi / JZe / Hn / SHA / sd):
 *
 *   EGi() = `https://downloads.claude.ai/vms/linux/${arch}/${Hn.sha}`
 *   file URL = `${EGi()}/${name}.zst`  (e.g. rootfs.img.zst)
 *   checksum = Hn.files[platform][arch][].checksum (sha256 of compressed .zst)
 *   on success: write name, `.${name}.origin` = Hn.sha, cache `${name}.zst` + zst.origin
 *
 * Product: implement download + zstd decompress + origin markers.
 * Does not invent a fake bundle when download fails — caller keeps missing status.
 * Network may be unavailable offline; link-claudevm-bundle residual remains valid.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import {
  COWORK_VM_BUNDLE_SHA,
  resolveCoworkVmArch,
} from "./coworkClaudeVm";

export type CoworkVmBundleFileSpec = {
  checksum: string;
  name: string;
  progressEnd?: number;
  progressStart?: number;
};

/** Official Hn.files.darwin (this app.asar cut). */
export const COWORK_VM_BUNDLE_FILES: Record<
  string,
  Record<string, CoworkVmBundleFileSpec[]>
> = {
  darwin: {
    arm64: [
      {
        name: "rootfs.img",
        checksum:
          "cb93e2748afd6022bcae48db01776d4ad4308ca8c0ea54bd2af48b1aeed8a242",
        progressStart: 0,
        progressEnd: 100,
      },
    ],
    x64: [
      {
        name: "rootfs.img",
        checksum:
          "e2087478e3972f200da883b1df824efb966a08b927f3fc021a32844b594d7033",
        progressStart: 0,
        progressEnd: 100,
      },
    ],
  },
};

export type CoworkVmBundleFileStatus =
  | { ready: true }
  | { ready: false; reason: "missing" | "origin_missing" | "version_mismatch" | "origin_read_error" };

/** Official JZe */
export function coworkVmBundleFileStatus(
  bundlePath: string,
  fileName: string,
  expectedSha: string = COWORK_VM_BUNDLE_SHA,
): CoworkVmBundleFileStatus {
  const filePath = path.join(bundlePath, fileName);
  const originPath = path.join(bundlePath, `.${fileName}.origin`);
  if (!fs.existsSync(filePath)) return { ready: false, reason: "missing" };
  if (!fs.existsSync(originPath)) {
    // Product legacy: bare rootfs without origin is accepted by isCoworkVmBundleReady;
    // download path still prefers origin match when present.
    return { ready: false, reason: "origin_missing" };
  }
  try {
    const have = fs.readFileSync(originPath, "utf8").trim();
    if (have !== expectedSha) {
      return { ready: false, reason: "version_mismatch" };
    }
  } catch {
    return { ready: false, reason: "origin_read_error" };
  }
  return { ready: true };
}

/** Official EGi */
export function resolveCoworkVmDownloadBaseUrl(
  arch: string = process.arch,
  sha: string = COWORK_VM_BUNDLE_SHA,
): string {
  return `https://downloads.claude.ai/vms/linux/${resolveCoworkVmArch(arch)}/${sha}`;
}

export function listCoworkVmBundleFiles(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): CoworkVmBundleFileSpec[] {
  const a = resolveCoworkVmArch(arch);
  return COWORK_VM_BUNDLE_FILES[platform]?.[a] ?? [];
}

export type CoworkVmDownloadProgress = {
  fileName: string;
  receivedBytes: number;
  totalBytes: number;
};

export type EnsureCoworkVmRootfsOptions = {
  arch?: string;
  /** Injected download (tests). Default: global fetch streaming. */
  downloadToFile?: (
    url: string,
    destPath: string,
    onProgress?: (received: number, total: number) => void,
  ) => Promise<{ sha256: string }>;
  /** Injected zstd decompress (tests). Default: `zstd -d -f -o out in`. */
  decompressZst?: (zstPath: string, outPath: string) => Promise<void>;
  expectedSha?: string;
  onProgress?: (progress: CoworkVmDownloadProgress) => void;
  platform?: NodeJS.Platform;
  /** When true, re-download even if ready. */
  force?: boolean;
};

async function defaultDownloadToFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<{ sha256: string }> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with status code: ${response.status}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  const hash = createHash("sha256");
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const out = createWriteStream(destPath, { mode: 0o600 });
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      hash.update(value);
      received += value.length;
      onProgress?.(received, total);
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once("drain", resolve));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err) => (err ? reject(err) : resolve()));
    });
  }
  return { sha256: hash.digest("hex") };
}

function defaultDecompressZst(zstPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "zstd",
      ["-d", "-f", "-o", outPath, zstPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr?.on("data", (c) => {
      err += String(c);
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `zstd decompress failed to start (${error.message}). Install zstd or use linked rootfs residual.`,
        ),
      );
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zstd exited ${code}: ${err.slice(0, 500)}`));
    });
  });
}

export type EnsureCoworkVmRootfsResult = {
  bundlePath: string;
  downloaded: boolean;
  files: Array<{ name: string; ready: boolean; reason?: string }>;
  ok: boolean;
  error?: string;
};

/**
 * Ensure official rootfs files exist under bundlePath with matching origin sha.
 * Downloads compressed .zst when missing/mismatched; verifies checksum; decompresses.
 */
export async function ensureCoworkVmRootfs(
  bundlePath: string,
  options: EnsureCoworkVmRootfsOptions = {},
): Promise<EnsureCoworkVmRootfsResult> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const expectedSha = options.expectedSha ?? COWORK_VM_BUNDLE_SHA;
  const files = listCoworkVmBundleFiles(platform, arch);
  const downloadToFile = options.downloadToFile ?? defaultDownloadToFile;
  const decompressZst = options.decompressZst ?? defaultDecompressZst;
  const baseUrl = resolveCoworkVmDownloadBaseUrl(arch, expectedSha);

  await fsp.mkdir(bundlePath, { recursive: true });

  if (files.length === 0) {
    return {
      bundlePath,
      downloaded: false,
      files: [],
      ok: false,
      error: `No bundle file list for ${platform}/${resolveCoworkVmArch(arch)}`,
    };
  }

  const fileResults: EnsureCoworkVmRootfsResult["files"] = [];
  let downloaded = false;

  try {
    for (const spec of files) {
      const status = coworkVmBundleFileStatus(
        bundlePath,
        spec.name,
        expectedSha,
      );
      // Accept ready, or legacy bare rootfs without origin when not forcing.
      const bareReady =
        !options.force
        && fs.existsSync(path.join(bundlePath, spec.name))
        && status.reason === "origin_missing";
      if (status.ready || bareReady) {
        // Heal missing origin for legacy linked bundles.
        if (bareReady) {
          await fsp.writeFile(
            path.join(bundlePath, `.${spec.name}.origin`),
            expectedSha,
            "utf8",
          );
        }
        fileResults.push({ name: spec.name, ready: true });
        continue;
      }

      if (status.reason === "version_mismatch") {
        await fsp.unlink(path.join(bundlePath, spec.name)).catch(() => undefined);
        await fsp
          .unlink(path.join(bundlePath, `.${spec.name}.origin`))
          .catch(() => undefined);
        await fsp
          .unlink(path.join(bundlePath, `${spec.name}.zst`))
          .catch(() => undefined);
        await fsp
          .unlink(path.join(bundlePath, `.${spec.name}.zst.origin`))
          .catch(() => undefined);
      }

      const tmpDir = await fsp.mkdtemp(path.join(bundlePath, ".wvm-tmp-"));
      try {
        const zstName = `${spec.name}.zst`;
        const url = `${baseUrl}/${zstName}`;
        const tmpZst = path.join(tmpDir, zstName);
        const tmpOut = path.join(tmpDir, spec.name);
        const { sha256 } = await downloadToFile(url, tmpZst, (received, total) => {
          options.onProgress?.({
            fileName: spec.name,
            receivedBytes: received,
            totalBytes: total,
          });
        });
        if (sha256 !== spec.checksum) {
          throw new Error(
            `Checksum mismatch for ${zstName}: expected ${spec.checksum}, got ${sha256}`,
          );
        }
        await decompressZst(tmpZst, tmpOut);
        const finalOut = path.join(bundlePath, spec.name);
        const finalZst = path.join(bundlePath, zstName);
        await fsp.rename(tmpOut, finalOut);
        await fsp.writeFile(
          path.join(bundlePath, `.${spec.name}.origin`),
          expectedSha,
          "utf8",
        );
        // Cache compressed copy like official.
        await fsp.rename(tmpZst, finalZst).catch(async () => {
          await fsp.copyFile(tmpZst, finalZst);
        });
        await fsp.writeFile(
          path.join(bundlePath, `.${spec.name}.zst.origin`),
          expectedSha,
          "utf8",
        );
        downloaded = true;
        fileResults.push({ name: spec.name, ready: true });
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    return {
      bundlePath,
      downloaded,
      files: fileResults,
      ok: fileResults.every((f) => f.ready),
    };
  } catch (error) {
    return {
      bundlePath,
      downloaded,
      files: fileResults,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
