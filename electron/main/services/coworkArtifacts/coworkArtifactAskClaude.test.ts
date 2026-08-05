import { describe, expect, it, beforeEach } from "vitest";
import {
  askClaudeCacheKey,
  askClaudeCz,
  askClaudeResidual,
  buildArtifactSamplePrompt,
  resetAskClaudeCacheForTests,
  runArtifactSampleWnr,
} from "./coworkArtifactAskClaude";

describe("coworkArtifactAskClaude residual", () => {
  beforeEach(() => {
    resetAskClaudeCacheForTests();
  });

  it("cz shape is k2i error bag", () => {
    expect(askClaudeCz("Artifact inference is not enabled.")).toEqual({
      text: "Artifact inference is not enabled.",
      isError: true,
    });
  });

  it("gate off → inference not enabled (never invent ok)", async () => {
    const result = await askClaudeResidual("summarize", [], {
      isInferenceEnabled: () => false,
      getShownArtifactId: () => "art-1",
    });
    expect(result).toEqual({
      text: "Artifact inference is not enabled.",
      isError: true,
    });
  });

  it("gate on but no shown artifact → not currently shown", async () => {
    const result = await askClaudeResidual("summarize", [], {
      isInferenceEnabled: () => true,
      getShownArtifactId: () => undefined,
    });
    expect(result).toEqual({
      text: "Artifact is not currently shown.",
      isError: true,
    });
  });

  it("Wnr binary missing → still starting up", async () => {
    const result = await runArtifactSampleWnr("hi", [], {
      resolveBinaryPath: () => null,
      getOAuthToken: async () => "tok",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/still starting up/i);
  });

  it("Wnr no oauth → Not signed in", async () => {
    const result = await runArtifactSampleWnr("hi", [], {
      resolveBinaryPath: () => "/opt/claude/bin/claude",
      getOAuthToken: async () => null,
    });
    expect(result).toEqual({ text: "Not signed in.", isError: true });
  });

  it("Wnr whitespace-only oauth → Not signed in", async () => {
    const result = await runArtifactSampleWnr("hi", [], {
      resolveBinaryPath: () => "/opt/claude/bin/claude",
      getOAuthToken: async () => "   \t  ",
    });
    expect(result).toEqual({ text: "Not signed in.", isError: true });
  });

  it("Wnr relative binary path → still starting up", async () => {
    const result = await runArtifactSampleWnr("hi", [], {
      resolveBinaryPath: () => "claude",
      getOAuthToken: async () => "tok",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/still starting up/i);
  });

  it("full residual with inject runSample returns real sample text", async () => {
    const result = await askClaudeResidual("classify", [{ a: 1 }], {
      isInferenceEnabled: () => true,
      getShownArtifactId: () => "art-9",
      resolveBinaryPath: () => "/opt/claude/bin/claude",
      getOAuthToken: async () => "access-token",
      runSample: async () => ({ text: "positive" }),
    });
    expect(result).toEqual({ text: "positive" });
  });

  it("cache hit skips second sample", async () => {
    let calls = 0;
    const deps = {
      isInferenceEnabled: () => true,
      getShownArtifactId: () => "art-cache",
      resolveBinaryPath: () => "/opt/claude/bin/claude",
      getOAuthToken: async () => "tok",
      runSample: async () => {
        calls++;
        return { text: `n=${calls}` };
      },
      cacheTtlMs: 60_000,
    };
    const a = await askClaudeResidual("p", [1], deps);
    const b = await askClaudeResidual("p", [1], deps);
    expect(a).toEqual({ text: "n=1" });
    expect(b).toEqual({ text: "n=1" });
    expect(calls).toBe(1);
  });

  it("shown artifact change mid-flight → no longer shown", async () => {
    let shown: string | undefined = "art-a";
    const result = await askClaudeResidual("p", [], {
      isInferenceEnabled: () => true,
      getShownArtifactId: () => shown,
      resolveBinaryPath: () => "/opt/claude/bin/claude",
      getOAuthToken: async () => "tok",
      runSample: async () => {
        shown = "art-b";
        return { text: "should-not-return" };
      },
    });
    expect(result).toEqual({
      text: "Artifact is no longer shown.",
      isError: true,
    });
  });

  it("$nr wraps data blocks", () => {
    expect(buildArtifactSamplePrompt("sum", ["x", { y: 1 }])).toContain(
      "<data>x</data>",
    );
    expect(buildArtifactSamplePrompt("sum", undefined)).toBe("sum");
  });

  it("Dhe cache key is stable md5 hex", () => {
    const a = askClaudeCacheKey("p", [1]);
    const b = askClaudeCacheKey("p", [1]);
    const c = askClaudeCacheKey("p", [2]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(a).not.toBe(c);
  });
});
