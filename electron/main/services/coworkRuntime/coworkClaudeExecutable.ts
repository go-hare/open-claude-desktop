import fs from "node:fs";
import path from "node:path";

function binaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

export function coworkClaudeExecutableCandidates(): string[] {
  const name = binaryName();
  const candidates = [
    process.env.CLAUDE_CODE_EXECUTABLE,
    process.env.CLAUDE_DESKTOP_RESOURCES_ROOT
      ? path.join(process.env.CLAUDE_DESKTOP_RESOURCES_ROOT, "claude-code-bin", name)
      : undefined,
    process.resourcesPath
      ? path.join(process.resourcesPath, "claude-code-bin", name)
      : undefined,
    path.resolve(process.cwd(), "resources", "claude-code-bin", name),
  ];
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
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

