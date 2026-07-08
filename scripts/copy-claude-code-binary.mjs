import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = path.join(projectRoot, "resources", "claude-code-bin");
const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
const targetBinary = path.join(targetRoot, binaryName);

function candidatePaths() {
  const candidates = [
    process.env.CLAUDE_CODE_BINARY_SOURCE,
    process.env.CLAUDE_CODE_EXECUTABLE,
  ];
  if (process.platform === "win32") {
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, "npm", "node_modules", "@go-hare", "claude-code", "bin", "claude.exe"),
        path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"),
      );
    }
    if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, ".bun", "bin", "claude.exe"));
  } else {
    candidates.push("/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude");
  }
  return [...new Set(candidates.filter(Boolean))];
}

function isExecutableCandidate(filePath) {
  if (!fsSync.existsSync(filePath)) return false;
  const stat = fsSync.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) return false;
  if (process.platform === "win32") return path.basename(filePath).toLowerCase() === "claude.exe";
  return true;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex");
}

function versionOf(filePath) {
  try {
    return execFileSync(filePath, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
  } catch (error) {
    return `version_unavailable: ${error?.message ?? String(error)}`;
  }
}

const sourceBinary = candidatePaths().find(isExecutableCandidate);
if (!sourceBinary) {
  throw new Error(`Claude Code binary not found. Set CLAUDE_CODE_BINARY_SOURCE or CLAUDE_CODE_EXECUTABLE to claude.exe. Tried:\n${candidatePaths().join("\n")}`);
}

await fs.rm(targetRoot, { recursive: true, force: true });
await fs.mkdir(targetRoot, { recursive: true });
await fs.copyFile(sourceBinary, targetBinary);
if (process.platform !== "win32") await fs.chmod(targetBinary, 0o755);

const manifest = {
  generated_at: new Date().toISOString(),
  source: sourceBinary,
  binary: binaryName,
  size: fsSync.statSync(targetBinary).size,
  sha256: sha256(targetBinary),
  version: versionOf(targetBinary),
};
await fs.writeFile(path.join(targetRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`claude code binary copied: ${path.relative(projectRoot, sourceBinary)} -> ${path.relative(projectRoot, targetBinary)}`);
console.log(JSON.stringify({ version: manifest.version, size: manifest.size, sha256: manifest.sha256 }, null, 2));
