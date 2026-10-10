import { expect, it } from "vitest";
import { OFFICIAL_CLAUDE_CODE_RELEASE } from "./officialClaudeCodeRelease";
import {
  officialClaudeCodeExecutableCandidates,
  resolveGoHareClaudeCodeNative,
} from "./officialClaudeCodeManager";

it("lists go-hare SDK native CLI first, Ta userData as fallback", () => {
  expect(OFFICIAL_CLAUDE_CODE_RELEASE.version).toBe("2.1.128");
  const candidates = officialClaudeCodeExecutableCandidates();
  const joined = candidates.join("\n");
  const native = resolveGoHareClaudeCodeNative();
  if (native) {
    expect(candidates[0] === native || candidates.includes(native)).toBe(true);
    expect(joined).toContain("@go-hare/claude-code-");
  }
  expect(joined).toContain("claude-code");
  expect(joined).not.toContain("claude-code-bin");
  expect(joined).not.toContain("@anthropic-ai/claude-agent-sdk-");
});
