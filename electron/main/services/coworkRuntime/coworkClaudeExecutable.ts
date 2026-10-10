import fs from "node:fs";
import path from "node:path";
import {
  officialClaudeCodeExecutableCandidates,
  resolveOfficialClaudeCodeExecutable,
} from "../localSessions/officialClaudeCodeManager";

/**
 * Host-loop residual: same CLI as Code Query (`@go-hare/claude-code-*`
 * native, Ta userData fallback). Dual-exec guest still uses
 * `/usr/local/bin/claude` in the factory.
 */
export function coworkClaudeExecutableCandidates(): string[] {
  return officialClaudeCodeExecutableCandidates();
}

export async function resolveCoworkClaudeExecutable(): Promise<string> {
  return resolveOfficialClaudeCodeExecutable();
}

export function resolveCoworkDisclaimerExecutable(): string | undefined {
  const candidates = [
    process.env.CLAUDE_DISCLAIMER_EXECUTABLE,
    process.resourcesPath
      ? path.resolve(process.resourcesPath, "..", "Helpers", "disclaimer")
      : undefined,
    path.resolve(
      process.cwd(),
      "out/Claudex-darwin-arm64/Claudex.app/Contents/Helpers/disclaimer",
    ),
  ];
  return candidates.find(
    (candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate)),
  );
}
