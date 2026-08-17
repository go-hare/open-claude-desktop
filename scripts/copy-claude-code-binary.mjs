/**
 * Bundle @go-hare/claude-code platform binaries into resources/claude-code-bin.
 *
 * Runtime residual (host-loop / Code spawn) only needs the **host** binary:
 *   platforms/<hostPlatformKey>/claude[.exe] + top-level copy + sibling vendor/rg.
 * Linux/win guests do not load foreign host-tree binaries from this folder.
 *
 * Default: **host-only** (mac package → mac CLI only). Full multi-platform matrix
 * is opt-in for CI / dual-exec guest prep that needs every npm optional package.
 *
 * Env:
 *   CLAUDE_CODE_NPM_VERSION   default 2.7.43
 *   CLAUDE_CODE_BINARY_SOURCE / CLAUDE_CODE_EXECUTABLE  optional override for host binary only
 *   CLAUDE_CODE_ALL_PLATFORMS=1  fetch all PLATFORM_PACKAGES (opt-in fat tree)
 *   CLAUDE_CODE_SKIP_PLATFORMS=1  legacy alias of host-only (default; kept for scripts)
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(projectRoot, "resources", "claude-code-bin");
const VERSION = process.env.CLAUDE_CODE_NPM_VERSION || "2.7.43";
/** Opt-in fat matrix. Default is host-only (mac packages mac, win packages win). */
const ALL_PLATFORMS = process.env.CLAUDE_CODE_ALL_PLATFORMS === "1";
/** Legacy env: when set to 1, force host-only even if ALL_PLATFORMS is also set. */
const FORCE_HOST_ONLY = process.env.CLAUDE_CODE_SKIP_PLATFORMS === "1";
const HOST_ONLY = FORCE_HOST_ONLY || !ALL_PLATFORMS;

/** Platform package key → binary file name inside the npm package. */
const PLATFORM_PACKAGES = [
  { key: "darwin-arm64", pkg: "@go-hare/claude-code-darwin-arm64", binary: "claude" },
  { key: "darwin-x64", pkg: "@go-hare/claude-code-darwin-x64", binary: "claude" },
  { key: "linux-x64", pkg: "@go-hare/claude-code-linux-x64", binary: "claude" },
  { key: "linux-arm64", pkg: "@go-hare/claude-code-linux-arm64", binary: "claude" },
  { key: "linux-x64-musl", pkg: "@go-hare/claude-code-linux-x64-musl", binary: "claude" },
  { key: "linux-arm64-musl", pkg: "@go-hare/claude-code-linux-arm64-musl", binary: "claude" },
  { key: "win32-x64", pkg: "@go-hare/claude-code-win32-x64", binary: "claude.exe" },
  { key: "win32-arm64", pkg: "@go-hare/claude-code-win32-arm64", binary: "claude.exe" },
];

function hostPlatformKey() {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "win32") return `win32-${arch}`;
  if (platform === "linux") return `linux-${arch}`;
  return `${platform}-${arch}`;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex");
}

function versionOf(filePath) {
  try {
    return execFileSync(filePath, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch (error) {
    return `version_unavailable: ${error?.message ?? String(error)}`;
  }
}

/** Resolve npm CLI so Windows Git Bash / non-shell spawn works (spawnSync "npm" → ENOENT). */
function resolveNpmInvocation() {
  const nodeDir = path.dirname(process.execPath);
  const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
  if (fsSync.existsSync(npmCli)) {
    return { command: process.execPath, argsPrefix: [npmCli] };
  }
  if (process.platform === "win32") {
    const npmCmd = path.join(nodeDir, "npm.cmd");
    if (fsSync.existsSync(npmCmd)) {
      return { command: npmCmd, argsPrefix: [], shell: true };
    }
  }
  return { command: "npm", argsPrefix: [] };
}

function npmViewTarball(pkg, version) {
  const npm = resolveNpmInvocation();
  const out = execFileSync(npm.command, [...npm.argsPrefix, "view", `${pkg}@${version}`, "dist.tarball"], {
    encoding: "utf8",
    timeout: 60_000,
    shell: Boolean(npm.shell),
  }).trim();
  if (!out.startsWith("http")) {
    throw new Error(`npm view tarball failed for ${pkg}@${version}: ${out}`);
  }
  return out;
}

function envProxy() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ""
  );
}

function fetchToFile(url, dest) {
  const proxy = envProxy();
  // Node https.get ignores HTTP(S)_PROXY. On this host GitHub/npm HTTPS
  // needs 127.0.0.1:12000 — use curl so copy:claude-code-binary can pin 2.7.43.
  if (proxy) {
    try {
      execFileSync("curl", ["-fsSL", "--connect-timeout", "20", "--retry", "2", "-x", proxy, "-o", dest, url], {
        timeout: 600_000,
        stdio: ["ignore", "inherit", "inherit"],
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchToFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} → ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(dest);
      pipeline(res, out).then(resolve, reject);
    });
    req.on("error", reject);
  });
}

async function extractPackageTgz(tgzPath, extractDir) {
  await fs.mkdir(extractDir, { recursive: true });
  // Windows: execFileSync("tar") often fails on drive-letter backslash paths
  // (ENOENT / "Command failed") even when Git Bash tar can extract the same file.
  // Prefer POSIX-style paths; fall back to node:zlib + tar stream if needed.
  const tgzPosix = tgzPath.replace(/\\/g, "/");
  const dirPosix = extractDir.replace(/\\/g, "/");
  try {
    execFileSync("tar", ["-xzf", tgzPosix, "-C", dirPosix], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return;
  } catch (tarError) {
    const { createGunzip } = await import("node:zlib");
    const { createReadStream } = await import("node:fs");
    // Lightweight fallback without external tar: use npm's own tar if present,
    // else rethrow with the original tar stderr for diagnosis.
    try {
      const tar = await import("tar");
      await tar.x({ file: tgzPath, cwd: extractDir });
      return;
    } catch {
      const detail =
        (tarError?.stderr && String(tarError.stderr).trim()) ||
        tarError?.message ||
        String(tarError);
      throw new Error(`tar extract failed for ${tgzPath}: ${detail}`);
    }
  }
}

async function downloadPlatformBinary(entry, version, platformsRoot, tmpRoot) {
  const tarball = npmViewTarball(entry.pkg, version);
  const tgzPath = path.join(tmpRoot, `${entry.key}.tgz`);
  const extractDir = path.join(tmpRoot, entry.key);
  console.log(`download ${entry.pkg}@${version}`);
  await fetchToFile(tarball, tgzPath);
  await fs.rm(extractDir, { recursive: true, force: true });
  await extractPackageTgz(tgzPath, extractDir);

  const packageDir = path.join(extractDir, "package");
  const srcBinary = path.join(packageDir, entry.binary);
  if (!fsSync.existsSync(srcBinary)) {
    throw new Error(`Missing ${entry.binary} in ${entry.pkg} tarball (${packageDir})`);
  }
  const destDir = path.join(platformsRoot, entry.key);
  await fs.mkdir(destDir, { recursive: true });
  const destBinary = path.join(destDir, entry.binary);
  await fs.copyFile(srcBinary, destBinary);
  if (!entry.binary.endsWith(".exe")) await fs.chmod(destBinary, 0o755);

  const vendorSrc = path.join(packageDir, "vendor");
  if (fsSync.existsSync(vendorSrc)) {
    const vendorDest = path.join(destDir, "vendor");
    await fs.rm(vendorDest, { recursive: true, force: true });
    await fs.cp(vendorSrc, vendorDest, { recursive: true });
    // npm package ships vendor/ripgrep/<arch-platform>/rg without +x in some tarballs.
    await ensureVendorExecutables(vendorDest);
  }

  return destBinary;
}

/** Walk vendor tree: +x on rg/rg.exe so posix_spawn works after npm tarball extract. */
async function ensureVendorExecutables(vendorRoot) {
  if (!fsSync.existsSync(vendorRoot)) return;
  const stack = [vendorRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of await fs.readdir(dir)) {
      const full = path.join(dir, name);
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      const base = name.toLowerCase();
      if (base === "rg" || base === "rg.exe") {
        try {
          await fs.chmod(full, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Replace dest even if a running process still has the old inode open. */
async function replaceFile(src, dest) {
  await fs.rm(dest, { force: true });
  await fs.copyFile(src, dest);
}

/**
 * Host-loop spawn resolves resources/claude-code-bin/claude (top-level).
 * CLI getBuiltinRipgrepCandidates looks at execDir/vendor/ripgrep/<platform>/rg
 * (claude-code-1 ripgrep.ts). Top-level must mirror platforms/<host>/vendor or
 * Glob/Grep fail with ENOENT on /$bunfs/root/vendor/... or the missing path.
 */
async function installTopLevelVendor(targetRoot, platformsRoot, hostKey) {
  const hostVendor = path.join(platformsRoot, hostKey, "vendor");
  if (!fsSync.existsSync(hostVendor)) {
    console.warn(`[copy-claude-code-binary] no vendor for host ${hostKey}; Glob/Grep may fail`);
    return false;
  }
  const topVendor = path.join(targetRoot, "vendor");
  await fs.rm(topVendor, { recursive: true, force: true });
  await fs.cp(hostVendor, topVendor, { recursive: true });
  await ensureVendorExecutables(topVendor);
  return true;
}

function clearDarwinQuarantineAndAdhocSign(filePath) {
  if (process.platform !== "darwin") return;
  try {
    execFileSync("xattr", ["-cr", filePath], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  try {
    execFileSync("codesign", ["--force", "-s", "-", filePath], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

async function signDarwinVendorTree(vendorRoot) {
  if (process.platform !== "darwin" || !fsSync.existsSync(vendorRoot)) return;
  const stack = [vendorRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of await fs.readdir(dir)) {
      const full = path.join(dir, name);
      const st = await fs.stat(full);
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;
      if (name === "rg" || (!name.includes(".") && st.size > 1024)) {
        clearDarwinQuarantineAndAdhocSign(full);
      }
    }
  }
}

/**
 * Explicit host override only (env). Do NOT auto-pick /usr/local/bin/claude —
 * that silently replaced the pinned npm platform binary with an older global
 * install (e.g. 2.7.1 over 2.7.14), breaking ultracode/xhigh packaging.
 */
function explicitHostOverride() {
  const candidates = [process.env.CLAUDE_CODE_BINARY_SOURCE, process.env.CLAUDE_CODE_EXECUTABLE];
  return candidates.filter(Boolean).find(isExecutableCandidate) ?? null;
}

function isExecutableCandidate(filePath) {
  if (!fsSync.existsSync(filePath)) return false;
  const stat = fsSync.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) return false;
  if (process.platform === "win32") return path.basename(filePath).toLowerCase() === "claude.exe";
  return true;
}

async function main() {
  const tmpRoot = path.join(projectRoot, ".tmp", `claude-code-bin-${VERSION}`);
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  // Preserve nothing: full refresh for pinned version.
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });
  const platformsRoot = path.join(targetRoot, "platforms");
  await fs.mkdir(platformsRoot, { recursive: true });

  const binaries = {};
  const hostKey = hostPlatformKey();
  // Default host-only: mac packages mac, win packages win. Fat matrix is opt-in.
  const toFetch = HOST_ONLY
    ? PLATFORM_PACKAGES.filter((entry) => entry.key === hostKey)
    : PLATFORM_PACKAGES;
  console.log(
    `[copy-claude-code-binary] mode=${HOST_ONLY ? "host-only" : "all-platforms"} host=${hostKey} fetch=[${toFetch.map((e) => e.key).join(",")}]`,
  );

  for (const entry of toFetch) {
    try {
      const dest = await downloadPlatformBinary(entry, VERSION, platformsRoot, tmpRoot);
      const canExec =
        (process.platform === "darwin" && entry.key.startsWith("darwin") && entry.key.endsWith(process.arch === "arm64" ? "arm64" : "x64")) ||
        (process.platform === "linux" && entry.key.startsWith("linux") && entry.key.includes(process.arch)) ||
        (process.platform === "win32" && entry.key.startsWith("win32"));
      binaries[entry.key] = {
        binary: path.basename(dest),
        path: path.relative(targetRoot, dest).replaceAll("\\", "/"),
        size: fsSync.statSync(dest).size,
        sha256: sha256(dest),
        version: canExec ? versionOf(dest) : `${VERSION} (Claude Code)`,
      };
      console.log(`  -> ${binaries[entry.key].path} (${binaries[entry.key].size} bytes)`);
    } catch (error) {
      console.warn(`[copy-claude-code-binary] skip ${entry.key}: ${error?.message ?? error}`);
    }
  }

  const hostBinaryName = process.platform === "win32" ? "claude.exe" : "claude";
  // Prefer the platform package we just downloaded for this host (pinned VERSION).
  let hostSource =
    binaries[hostKey] && path.join(targetRoot, binaries[hostKey].path);

  const override = explicitHostOverride();
  if (override) {
    // Explicit env only — never silent PATH/global claude.
    hostSource = override;
    console.log(`host override (env): ${override}`);
  }
  if (!hostSource || !fsSync.existsSync(hostSource)) {
    throw new Error(
      `Host Claude Code binary not found for ${hostKey}. Set CLAUDE_CODE_BINARY_SOURCE to a ${VERSION} binary, or CLAUDE_CODE_ALL_PLATFORMS=1 if the host package failed to download.`,
    );
  }

  const topClaude = path.join(targetRoot, hostBinaryName);
  // Unlink first: a running host-loop child can keep the previous inode open and
  // make copyFile look like a no-op on some Darwin setups.
  await replaceFile(hostSource, topClaude);
  if (process.platform !== "win32") await fs.chmod(topClaude, 0o755);

  // Top-level foreign binaries only when fat matrix is requested.
  // Host-only mac must NOT ship claude.exe (was ~140MB dead weight).
  const topExe = path.join(targetRoot, "claude.exe");
  if (!HOST_ONLY) {
    const winSrc =
      binaries["win32-x64"] && path.join(targetRoot, binaries["win32-x64"].path);
    if (winSrc && fsSync.existsSync(winSrc) && hostBinaryName !== "claude.exe") {
      await replaceFile(winSrc, topExe);
    }
  }

  // Sibling vendor for top-level host binary (host-loop Glob/Grep).
  const topVendorInstalled = await installTopLevelVendor(targetRoot, platformsRoot, hostKey);

  // Clear mac quarantine + adhoc re-sign so Gatekeeper does not SIGKILL the host binary / rg.
  if (process.platform === "darwin") {
    clearDarwinQuarantineAndAdhocSign(topClaude);
    if (topVendorInstalled) {
      await signDarwinVendorTree(path.join(targetRoot, "vendor"));
    }
    // Also sign platform-tree rg used when spawn points at platforms/<host>/claude.
    await signDarwinVendorTree(path.join(platformsRoot, hostKey, "vendor"));
  }

  const hostVersion = versionOf(topClaude);
  const topVendorRg = path.join(
    targetRoot,
    "vendor",
    "ripgrep",
    process.platform === "win32" ? `${process.arch}-win32` : `${process.arch}-${process.platform}`,
    process.platform === "win32" ? "rg.exe" : "rg",
  );
  const manifest = {
    source: `@go-hare/claude-code@${VERSION}`,
    package: "@go-hare/claude-code",
    version: VERSION,
    binary: hostBinaryName,
    platform: process.platform,
    arch: process.arch,
    size: fsSync.statSync(topClaude).size,
    sha256: sha256(topClaude),
    versionLabel: hostVersion,
    topLevel: {
      [hostBinaryName]: {
        from: binaries[hostKey]?.path ?? hostSource,
        size: fsSync.statSync(topClaude).size,
        sha256: sha256(topClaude),
        version: hostVersion,
      },
    },
    vendor: topVendorInstalled
      ? {
          path: "vendor",
          ripgrep: fsSync.existsSync(topVendorRg)
            ? {
                path: path.relative(targetRoot, topVendorRg).replaceAll("\\", "/"),
                size: fsSync.statSync(topVendorRg).size,
                mode: (fsSync.statSync(topVendorRg).mode & 0o777).toString(8),
              }
            : null,
        }
      : null,
    binaries,
  };
  if (!HOST_ONLY && fsSync.existsSync(topExe) && hostBinaryName !== "claude.exe") {
    manifest.topLevel["claude.exe"] = {
      from: binaries["win32-x64"]?.path ?? "claude.exe",
      size: fsSync.statSync(topExe).size,
      sha256: sha256(topExe),
      version: binaries["win32-x64"]?.version ?? `${VERSION} (Claude Code)`,
    };
  }
  manifest.mode = HOST_ONLY ? "host-only" : "all-platforms";
  manifest.hostKey = hostKey;

  await fs.writeFile(path.join(targetRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

  console.log(
    JSON.stringify(
      {
        version: hostVersion,
        source: manifest.source,
        mode: manifest.mode,
        hostKey,
        platforms: Object.keys(binaries),
        topLevel: Object.keys(manifest.topLevel),
        vendor: manifest.vendor,
      },
      null,
      2,
    ),
  );
}

await main();
