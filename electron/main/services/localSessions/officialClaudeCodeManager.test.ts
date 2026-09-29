import { expect, it } from "vitest";
import { OFFICIAL_CLAUDE_CODE_RELEASE } from "./officialClaudeCodeRelease";
import { officialClaudeCodeExecutableCandidates } from "./officialClaudeCodeManager";

it("pins official VOe 2.1.128 and never lists SDK-package or go-hare bins", () => {
  expect(OFFICIAL_CLAUDE_CODE_RELEASE.version).toBe("2.1.128");
  expect(OFFICIAL_CLAUDE_CODE_RELEASE.baseUrl).toBe("https://downloads.claude.ai/claude-code-releases");
  expect(OFFICIAL_CLAUDE_CODE_RELEASE.manifest.platforms["darwin-arm64"].bundle).toBeTruthy();
  const candidates = officialClaudeCodeExecutableCandidates();
  expect(candidates.some((item) => item.includes("claude-code"))).toBe(true);
  expect(candidates.join("\n")).not.toContain("@anthropic-ai/claude-agent-sdk-");
  expect(candidates.join("\n")).not.toContain("claude-code-bin");
  expect(candidates.join("\n")).not.toContain("@go-hare");
});
