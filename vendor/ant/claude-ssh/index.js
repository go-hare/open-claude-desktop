const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { createZstdDecompress } = require("node:zlib");

const release = {
  "version": "869762545054f8caf5b0e36192651744a2461d3b",
  "manifest": {
    "version": "869762545054f8caf5b0e36192651744a2461d3b",
    "platforms": {
      "linux-amd64": {
        "checksum": "554fd922d489222df2882c63ca40f7fa43c87f6d3d62bb697b56c604d622de17",
        "size": 2214591
      },
      "linux-arm64": {
        "checksum": "e78b8a6e9530ad03ca156a4447d935220fc6a8e6b4fe27af4994611b2804df4b",
        "size": 1998978
      },
      "darwin-amd64": {
        "checksum": "935a098d302881d3008fed88faa84e05d53be275d0c14ea136c7b07b2ab3ec02",
        "size": 2241776
      },
      "darwin-arm64": {
        "checksum": "83113f1c6a06196d9aa4622d38f07ae38d007d9037e8d4cf6b498d34b9b3dff9",
        "size": 2068831
      },
      "windows-amd64": {
        "checksum": "83b6f81c9d4aabba1a961858de7658facae7899a1b133a659d79b055572ecb58",
        "size": 2262858
      },
      "windows-arm64": {
        "checksum": "ab8e1e73c6802736dba1d24b9b8632917eedf253cd89f4ef67a76d59e4165710",
        "size": 2012794
      }
    }
  },
  "baseUrl": "https://downloads.claude.ai/claude-ssh-releases"
};

function getReleaseMetadata() {
  return JSON.parse(JSON.stringify(release));
}

function getPlatformKey(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch;
  return os + '-' + cpu;
}

function getPlatformManifest(platformKey = getPlatformKey()) {
  return release.manifest.platforms[platformKey] || null;
}

function getDownloadUrl(platformKey = getPlatformKey()) {
  if (!getPlatformManifest(platformKey)) throw new Error('Platform ' + platformKey + ' not available in claude-ssh manifest');
  return release.baseUrl + '/' + release.version + '/' + platformKey + '/claude-ssh.zst';
}

function listPlatforms() {
  return Object.keys(release.manifest.platforms);
}

function getDefaultStorageDir() {
  return path.join(os.homedir(), ".claude", "claude-ssh-remote");
}

function getVersionDir(storageDir = getDefaultStorageDir()) {
  return path.join(storageDir, release.version);
}

function getBinaryPath(platformKey = getPlatformKey(), storageDir = getDefaultStorageDir()) {
  return path.join(getVersionDir(storageDir), "claude-ssh-" + platformKey);
}

function getVerifiedMarkerPath(platformKey = getPlatformKey(), storageDir = getDefaultStorageDir()) {
  return path.join(getVersionDir(storageDir), ".verified-" + platformKey);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyBinary(filePath, platformKey = getPlatformKey()) {
  const expected = getPlatformManifest(platformKey);
  if (!expected) return { ok: false, error: "Platform " + platformKey + " not available in claude-ssh manifest" };
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const checksum = await sha256File(filePath);
  return {
    ok: stat.size === expected.size && checksum === expected.checksum,
    size: stat.size,
    checksum,
    expected,
  };
}

async function binaryExists(platformKey = getPlatformKey(), storageDir = getDefaultStorageDir()) {
  const binaryPath = getBinaryPath(platformKey, storageDir);
  const markerPath = getVerifiedMarkerPath(platformKey, storageDir);
  try {
    await fsp.access(binaryPath, fs.constants.X_OK);
    await fsp.access(markerPath);
    return true;
  } catch {
    return false;
  }
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("Download failed with HTTP " + response.statusCode + " for " + url));
        return;
      }
      const bytes = Number(response.headers["content-length"] || 0) || null;
      pipeline(response, createZstdDecompress(), fs.createWriteStream(destination))
        .then(() => resolve({ bytesDownloaded: bytes }))
        .catch(reject);
    });
    request.on("error", reject);
  });
}

async function downloadBinary(platformKey = getPlatformKey(), options = {}) {
  const expected = getPlatformManifest(platformKey);
  if (!expected) throw new Error("Platform " + platformKey + " not available in claude-ssh manifest");
  const storageDir = options.storageDir || getDefaultStorageDir();
  const binaryPath = getBinaryPath(platformKey, storageDir);
  const markerPath = getVerifiedMarkerPath(platformKey, storageDir);
  const tempPath = binaryPath + ".tmp-" + process.pid;
  await fsp.mkdir(path.dirname(binaryPath), { recursive: true });
  await fsp.rm(tempPath, { force: true }).catch(() => {});
  try {
    const transfer = await download(getDownloadUrl(platformKey), tempPath);
    const verified = await verifyBinary(tempPath, platformKey);
    if (!verified.ok) {
      throw new Error("Checksum verification failed for " + platformKey + ": expected=" + expected.checksum + " actual=" + verified.checksum + " size=" + verified.size);
    }
    await fsp.rename(tempPath, binaryPath);
    await fsp.chmod(binaryPath, 0o755).catch(() => {});
    await fsp.writeFile(markerPath, "");
    return { ready: true, path: binaryPath, ...transfer };
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function prepare(platformKey = getPlatformKey(), options = {}) {
  const storageDir = options.storageDir || getDefaultStorageDir();
  if (await binaryExists(platformKey, storageDir)) {
    return { ready: true, path: getBinaryPath(platformKey, storageDir) };
  }
  try {
    return await downloadBinary(platformKey, { storageDir });
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  version: release.version,
  requiredVersion: release.version,
  manifest: release.manifest,
  baseUrl: release.baseUrl,
  getReleaseMetadata,
  getPlatformKey,
  getPlatformManifest,
  getDownloadUrl,
  listPlatforms,
  getDefaultStorageDir,
  getVersionDir,
  getBinaryPath,
  getVerifiedMarkerPath,
  verifyBinary,
  binaryExists,
  downloadBinary,
  prepare,
};
