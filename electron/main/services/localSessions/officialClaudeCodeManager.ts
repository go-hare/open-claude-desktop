/**
 * Official ClaudeCodeManager residual (`index.js` jki / Ta).
 *
 * Host CLI is NOT the Agent SDK optional package and NOT go-hare.
 *   storageDir = userData/claude-code
 *   requiredVersion = VOe().version (2.1.128)
 *   darwin + bundle in manifest → claude.app.tar.zst → claude.app/Contents/MacOS/claude
 *   else → {binaryName}.zst
 *   ready = binary + sibling .verified
 *   CLAUDE_CODE_LOCAL_BINARY → initLocalBinary override
 *
 * LocalSessionManager.resolveBinaryPathFresh stamps options.pathToClaudeCodeExecutable.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import type { Transform } from "node:zlib";
import { readAppliedCustom3pFromDesktopShellSettings } from "../custom3p/custom3pCliEnv";
import {
  OFFICIAL_CLAUDE_CODE_RELEASE,
  type OfficialClaudeCodePlatformId,
} from "./officialClaudeCodeRelease";

const BUNDLE_REL = path.join("claude.app", "Contents", "MacOS", "claude");

export type ClaudeCodeInstallStatus =
  | "not_installed"
  | "updating"
  | "ready"
  | "download_failed";

type HostTarget = {
  storageDir: string;
  platform: OfficialClaudeCodePlatformId;
  binaryName: string;
  useBundle: boolean;
  logPrefix: string;
};

function zstdDecompressTransform(): Transform {
  const zlib = require("node:zlib") as typeof import("node:zlib") & {
    createZstdDecompress?: () => Transform;
  };
  if (typeof zlib.createZstdDecompress === "function") {
    return zlib.createZstdDecompress();
  }
  throw new Error("zstd decompress is not available in this Node build");
}

function hostPlatform(): OfficialClaudeCodePlatformId {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (process.platform === "win32") {
    return arch === "arm64" ? "win32-arm64" : "win32-x64";
  }
  throw new Error(`Unsupported platform: ${process.platform}-${arch}`);
}

function userDataRoot(): string {
  try {
    const { app } = require("electron") as typeof import("electron");
    if (app?.isReady?.() || app?.getPath) return app.getPath("userData");
  } catch {
    /* tests / early */
  }
  return process.env.CLAUDE_USER_DATA_DIR
    || path.join(os.homedir(), "Library", "Application Support", "Claudex");
}

async function pathExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDownloadProxy(): URL | null {
  const raw =
    process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy;
  if (raw) {
    try {
      return new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`);
    } catch {
      /* fall through */
    }
  }
  try {
    const snap = readAppliedCustom3pFromDesktopShellSettings(userDataRoot());
    const bag = snap.enterprise;
    const proxy = bag?.inferenceHttpsProxy?.trim() || bag?.inferenceHttpProxy?.trim();
    if (proxy) {
      return new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(proxy) ? proxy : `http://${proxy}`);
    }
  } catch {
    /* no bag */
  }
  return null;
}

async function downloadToBuffer(url: string, abort?: AbortSignal): Promise<Buffer> {
  try {
    const { net } = await import("electron");
    if (typeof net.fetch === "function") {
      const res = await net.fetch(url, { signal: abort });
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
      return Buffer.from(await res.arrayBuffer());
    }
  } catch (error) {
    console.warn(
      "[CCD] net.fetch download failed, falling back",
      error instanceof Error ? error.message : String(error),
    );
  }
  const proxy = resolveDownloadProxy();
  return new Promise((resolve, reject) => {
    const args = ["-fsSL", "--max-time", "180", url];
    if (proxy) args.unshift("--proxy", proxy.href);
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk as Buffer));
    child.stderr.on("data", (chunk) => errChunks.push(chunk as Buffer));
    child.on("error", reject);
    abort?.addEventListener("abort", () => child.kill("SIGTERM"));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`curl download failed (${code}): ${Buffer.concat(errChunks).toString("utf8").trim()}`));
    });
  });
}

async function extractTar(archivePath: string, cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", cwd], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar extract failed: ${code}`));
    });
  });
}

class OfficialClaudeCodeManager {
  private preparingPromise: Promise<{ ready: boolean; path?: string; error?: string }> | null = null;
  private hostDownloadFailed = false;
  private localBinaryPath: string | null = null;
  private readonly requiredVersion = OFFICIAL_CLAUDE_CODE_RELEASE.version;
  private readonly manifest = OFFICIAL_CLAUDE_CODE_RELEASE.manifest;
  private readonly baseUrl = OFFICIAL_CLAUDE_CODE_RELEASE.baseUrl;

  constructor() {
    const override = process.env.CLAUDE_CODE_LOCAL_BINARY;
    if (override) void this.initLocalBinary(override);
  }

  private storageDir(): string {
    return path.join(userDataRoot(), "claude-code");
  }

  async initLocalBinary(filePath: string): Promise<void> {
    try {
      await fs.access(filePath, fsSync.constants.X_OK);
      this.localBinaryPath = filePath;
    } catch {
      this.localBinaryPath = null;
    }
  }

  async getLocalBinaryPath(): Promise<string | null> {
    return this.localBinaryPath;
  }

  getRequiredVersion(): string {
    return this.localBinaryPath ? "local" : this.requiredVersion;
  }

  private getHostTarget(): HostTarget {
    const platform = hostPlatform();
    const spec = this.manifest.platforms[platform];
    const useBundle = process.platform === "darwin" && Boolean(spec && "bundle" in spec && spec.bundle);
    return {
      storageDir: this.storageDir(),
      platform,
      binaryName: process.platform === "win32" ? "claude.exe" : "claude",
      useBundle,
      logPrefix: "[CCD]",
    };
  }

  private getBinaryPathForTarget(target: HostTarget, version: string): string {
    return target.useBundle
      ? path.join(target.storageDir, version, BUNDLE_REL)
      : path.join(target.storageDir, version, target.binaryName);
  }

  private async binaryExistsForTarget(target: HostTarget, version: string): Promise<boolean> {
    const binary = this.getBinaryPathForTarget(target, version);
    const verified = path.join(target.storageDir, version, ".verified");
    try {
      await fs.access(binary, fsSync.constants.X_OK);
      await fs.access(verified);
      return true;
    } catch {
      return false;
    }
  }

  private async findInstalledBinaryPath(target: HostTarget, version: string): Promise<string | null> {
    const verified = path.join(target.storageDir, version, ".verified");
    try {
      await fs.access(verified);
    } catch {
      return null;
    }
    const plain = path.join(target.storageDir, version, target.binaryName);
    const bundled = path.join(target.storageDir, version, BUNDLE_REL);
    const order = process.platform !== "darwin"
      ? [plain]
      : target.useBundle
        ? [bundled, plain]
        : [plain, bundled];
    for (const candidate of order) {
      if (await pathExecutable(candidate)) return candidate;
    }
    return null;
  }

  private async getAnyInstalledBinaryPathForTarget(target: HostTarget): Promise<string | null> {
    try {
      await fs.access(target.storageDir);
      const entries = await fs.readdir(target.storageDir, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory())) {
        const found = await this.findInstalledBinaryPath(target, entry.name);
        if (found) return found;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async cleanupOldVersionsForTarget(target: HostTarget, keep: string): Promise<void> {
    try {
      if (!fsSync.existsSync(target.storageDir)) return;
      const entries = await fs.readdir(target.storageDir, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory())) {
        if (entry.name === keep) continue;
        await fs.rm(path.join(target.storageDir, entry.name), { recursive: true, force: true });
      }
    } catch {
      /* official logs and continues */
    }
  }

  private async downloadBinaryForTarget(target: HostTarget, version: string, abort?: AbortSignal): Promise<void> {
    const spec = this.manifest.platforms[target.platform];
    if (!spec) throw new Error(`Platform ${target.platform} not available`);
    if (target.useBundle && "bundle" in spec && spec.bundle) {
      await this.downloadBundleForTarget(target, version, spec.bundle, abort);
      return;
    }
    const dest = this.getBinaryPathForTarget(target, version);
    const dir = path.join(target.storageDir, version);
    await fs.mkdir(dir, { recursive: true });
    const url = `${this.baseUrl}/${version}/${target.platform}/${target.binaryName}.zst`;
    const compressed = await downloadToBuffer(url, abort);
    const sha = createHash("sha256").update(compressed).digest("hex");
    if (sha !== spec.checksum) {
      throw new Error(`Checksum verification failed`);
    }
    const zlib = require("node:zlib") as typeof import("node:zlib") & {
      zstdDecompressSync?: (buf: Buffer) => Buffer;
    };
    const raw = typeof zlib.zstdDecompressSync === "function"
      ? zlib.zstdDecompressSync(compressed)
      : await this.decompressZstdBuffer(compressed);
    await fs.writeFile(dest, raw);
    if (!(process.platform === "win32" && target.platform === hostPlatform())) {
      await fs.chmod(dest, 0o755);
    }
    await fs.writeFile(path.join(dir, ".verified"), "");
    await this.cleanupOldVersionsForTarget(target, version);
  }

  private async decompressZstdBuffer(compressed: Buffer): Promise<Buffer> {
    const transform = zstdDecompressTransform();
    const chunks: Buffer[] = [];
    transform.on("data", (chunk) => chunks.push(chunk as Buffer));
    await pipeline(
      (async function* () { yield compressed; })(),
      transform,
    );
    return Buffer.concat(chunks);
  }

  private async downloadBundleForTarget(
    target: HostTarget,
    version: string,
    bundle: { checksum: string; size: number },
    abort?: AbortSignal,
  ): Promise<void> {
    const dest = this.getBinaryPathForTarget(target, version);
    const dir = path.join(target.storageDir, version);
    await fs.mkdir(dir, { recursive: true });
    const url = `${this.baseUrl}/${version}/${target.platform}/claude.app.tar.zst`;
    const compressed = await downloadToBuffer(url, abort);
    const sha = createHash("sha256").update(compressed).digest("hex");
    if (sha !== bundle.checksum) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error("Bundle checksum verification failed");
    }
    const zlib = require("node:zlib") as typeof import("node:zlib") & {
      zstdDecompressSync?: (buf: Buffer) => Buffer;
    };
    const tarBytes = typeof zlib.zstdDecompressSync === "function"
      ? zlib.zstdDecompressSync(compressed)
      : await this.decompressZstdBuffer(compressed);
    const tarPath = path.join(dir, "claude.app.tar");
    await fs.writeFile(tarPath, tarBytes);
    try {
      await extractTar(tarPath, dir);
      await fs.access(dest, fsSync.constants.X_OK);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await fs.rm(tarPath, { force: true }).catch(() => undefined);
    }
    await fs.writeFile(path.join(dir, ".verified"), "");
    await this.cleanupOldVersionsForTarget(target, version);
  }

  private async prepareForTarget(target: HostTarget, abort?: AbortSignal): Promise<{
    ready: boolean;
    path?: string;
    error?: string;
  }> {
    try {
      if (await this.binaryExistsForTarget(target, this.requiredVersion)) {
        return { ready: true, path: this.getBinaryPathForTarget(target, this.requiredVersion) };
      }
      if (!this.manifest.platforms[target.platform]) {
        return { ready: false, error: "This version is not available for your device." };
      }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.downloadBinaryForTarget(target, this.requiredVersion, abort);
          return { ready: true, path: this.getBinaryPathForTarget(target, this.requiredVersion) };
        } catch (error) {
          console.warn(
            `${target.logPrefix} Download attempt ${attempt}/3 failed`,
            error instanceof Error ? error.message : String(error),
          );
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
      return { ready: false, error: "Download failed. Check your internet connection and try again." };
    } catch (error) {
      console.warn(
        `${target.logPrefix} Prepare failed`,
        error instanceof Error ? error.message : String(error),
      );
      return { ready: false, error: "Download failed. Check your internet connection and try again." };
    }
  }

  async getStatus(): Promise<ClaudeCodeInstallStatus> {
    if (await this.getLocalBinaryPath()) return "ready";
    const target = this.getHostTarget();
    if (this.preparingPromise) return "updating";
    if (await this.binaryExistsForTarget(target, this.requiredVersion)) return "ready";
    if (this.hostDownloadFailed) return "download_failed";
    try {
      const entries = fsSync.existsSync(target.storageDir)
        ? await fs.readdir(target.storageDir)
        : [];
      return entries.length > 0 ? "updating" : "not_installed";
    } catch {
      return "not_installed";
    }
  }

  async getBinaryPathIfReady(): Promise<string | null> {
    const local = await this.getLocalBinaryPath();
    if (local) return local;
    const target = this.getHostTarget();
    if (await this.binaryExistsForTarget(target, this.requiredVersion)) {
      return this.getBinaryPathForTarget(target, this.requiredVersion);
    }
    return this.getAnyInstalledBinaryPathForTarget(target);
  }

  async getHostBinaryPathIfPresent(): Promise<string | null> {
    const target = this.getHostTarget();
    const dest = this.getBinaryPathForTarget(target, this.requiredVersion);
    try {
      await fs.access(dest);
      return dest;
    } catch {
      return null;
    }
  }

  async prepare(): Promise<{ ready: boolean; path?: string; error?: string }> {
    const local = await this.getLocalBinaryPath();
    if (local) return { ready: true, path: local };
    if (this.preparingPromise) return this.preparingPromise;
    this.hostDownloadFailed = false;
    this.preparingPromise = this.prepareForTarget(this.getHostTarget());
    try {
      const result = await this.preparingPromise;
      if (!result.ready) this.hostDownloadFailed = true;
      return result;
    } finally {
      this.preparingPromise = null;
    }
  }

  /** Official resolveBinaryPathFresh residual. */
  async resolveBinaryPathFresh(): Promise<string> {
    const ready = await this.getBinaryPathIfReady();
    if (ready) return ready;
    const present = await this.getHostBinaryPathIfPresent();
    if (present) return present;
    const prepared = await this.prepare();
    if (prepared.ready && prepared.path) return prepared.path;
    throw new Error(`No path to Claude code executable${prepared.error ? ` (${prepared.error})` : ""}`);
  }
}

export const officialClaudeCodeManager = new OfficialClaudeCodeManager();

export async function resolveOfficialClaudeCodeExecutable(): Promise<string> {
  const envOverride = process.env.CLAUDE_CODE_EXECUTABLE;
  if (envOverride && fsSync.existsSync(envOverride)) return envOverride;
  return officialClaudeCodeManager.resolveBinaryPathFresh();
}

/**
 * Official Her ssh-cli-cache residual: download `{binary}.zst` for a *remote*
 * platform (not the host darwin bundle). Used by host-pipe SSH deploy.
 */
export async function materializeOfficialClaudeCliZstBinary(
  platform: OfficialClaudeCodePlatformId,
): Promise<string> {
  const spec = OFFICIAL_CLAUDE_CODE_RELEASE.manifest.platforms[platform];
  if (!spec) throw new Error(`Claude CLI not available for platform: ${platform}`);
  const version = OFFICIAL_CLAUDE_CODE_RELEASE.version;
  const cacheDir = path.join(userDataRoot(), "ssh-cli-cache");
  const binaryName = platform.startsWith("win32") ? "claude.exe" : "claude";
  const dest = path.join(cacheDir, `${version}-${platform}-${binaryName}`);
  if (fsSync.existsSync(dest)) {
    try {
      fsSync.accessSync(dest, fsSync.constants.X_OK);
      return dest;
    } catch {
      /* rewrite */
    }
  }
  await fs.mkdir(cacheDir, { recursive: true });
  const url = `${OFFICIAL_CLAUDE_CODE_RELEASE.baseUrl}/${version}/${platform}/${binaryName}.zst`;
  const compressed = await downloadToBuffer(url);
  const sha = createHash("sha256").update(compressed).digest("hex");
  if (sha !== spec.checksum) {
    throw new Error(`Checksum verification failed for ${platform}`);
  }
  const zlib = require("node:zlib") as typeof import("node:zlib") & {
    zstdDecompressSync?: (buf: Buffer) => Buffer;
  };
  const raw = typeof zlib.zstdDecompressSync === "function"
    ? zlib.zstdDecompressSync(compressed)
    : await (async () => {
      const transform = zstdDecompressTransform();
      const chunks: Buffer[] = [];
      transform.on("data", (chunk) => chunks.push(chunk as Buffer));
      await pipeline((async function* () { yield compressed; })(), transform);
      return Buffer.concat(chunks);
    })();
  const tmp = `${dest}.partial`;
  await fs.writeFile(tmp, raw);
  await fs.chmod(tmp, 0o755);
  await fs.rename(tmp, dest);
  return dest;
}

export function officialClaudeCodeExecutableCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.CLAUDE_CODE_EXECUTABLE) candidates.push(process.env.CLAUDE_CODE_EXECUTABLE);
  if (process.env.CLAUDE_CODE_LOCAL_BINARY) candidates.push(process.env.CLAUDE_CODE_LOCAL_BINARY);
  try {
    const targetPlatform = hostPlatform();
    const storage = path.join(userDataRoot(), "claude-code", OFFICIAL_CLAUDE_CODE_RELEASE.version);
    const spec = OFFICIAL_CLAUDE_CODE_RELEASE.manifest.platforms[targetPlatform];
    const useBundle = process.platform === "darwin" && Boolean(spec && "bundle" in spec && spec.bundle);
    const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
    candidates.push(
      useBundle ? path.join(storage, BUNDLE_REL) : path.join(storage, binaryName),
    );
  } catch {
    /* unsupported platform */
  }
  return [...new Set(candidates)];
}

/** Sync stamp for smoke / status when prepare already finished. */
export function resolveOfficialClaudeCodeExecutableSync(): string | null {
  const envOverride = process.env.CLAUDE_CODE_EXECUTABLE;
  if (envOverride && fsSync.existsSync(envOverride)) return envOverride;
  const local = process.env.CLAUDE_CODE_LOCAL_BINARY;
  if (local && fsSync.existsSync(local)) return local;
  const listed = officialClaudeCodeExecutableCandidates().find((item) => {
    if (!path.isAbsolute(item)) return false;
    try {
      fsSync.accessSync(item, fsSync.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  return listed ?? null;
}
