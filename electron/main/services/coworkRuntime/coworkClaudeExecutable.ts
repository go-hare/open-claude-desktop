import fs from "node:fs";
import path from "node:path";

function binaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/** Same key layout as scripts/copy-claude-code-binary.mjs platforms/<key>/. */
function hostPlatformKey(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "linux") return `linux-${arch}`;
  return `${process.platform}-${arch}`;
}

/**
 * Prefer platforms/<host>/claude when present: npm package ships binary + vendor
 * together. Top-level claude is a convenience copy; without sibling vendor,
 * Glob/Grep hit ENOENT on /$bunfs/root/vendor/ripgrep/... (CLI ripgrep.ts).
 */
function claudeBinCandidatesUnder(root: string): string[] {
  const name = binaryName();
  return [
    path.join(root, "platforms", hostPlatformKey(), name),
    path.join(root, name),
  ];
}

export function coworkClaudeExecutableCandidates(): string[] {
  const roots = [
    process.env.CLAUDE_DESKTOP_RESOURCES_ROOT
      ? path.join(process.env.CLAUDE_DESKTOP_RESOURCES_ROOT, "claude-code-bin")
      : undefined,
    process.resourcesPath ? path.join(process.resourcesPath, "claude-code-bin") : undefined,
    path.resolve(process.cwd(), "resources", "claude-code-bin"),
  ].filter((item): item is string => Boolean(item));

  const candidates: string[] = [];
  if (process.env.CLAUDE_CODE_EXECUTABLE) candidates.push(process.env.CLAUDE_CODE_EXECUTABLE);
  for (const root of roots) candidates.push(...claudeBinCandidatesUnder(root));
  return [...new Set(candidates)];
}

export function resolveCoworkClaudeExecutable(): string {
  return (
    coworkClaudeExecutableCandidates().find((candidate) => fs.existsSync(candidate)) ??
    (process.platform === "win32" ? "claude.cmd" : "claude")
  );
}

export function resolveCoworkDisclaimerExecutable(): string | undefined {
  const candidates = [
    process.env.CLAUDE_DISCLAIMER_EXECUTABLE,
    process.resourcesPath
      ? path.resolve(process.resourcesPath, "..", "Helpers", "disclaimer")
      : undefined,
    path.resolve(
      process.cwd(),
      "out/Claude-Deepseek-darwin-arm64/Claude-Deepseek.app/Contents/Helpers/disclaimer",
    ),
  ];
  return candidates.find(
    (candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)),
  );
}
