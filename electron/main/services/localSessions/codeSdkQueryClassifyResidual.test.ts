/**
 * Official qwA / n7i residual (app.asar LocalSessionManager).
 * 3221226505 = STATUS_STACK_BUFFER_OVERRUN → cli_fastfail.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp",
    isReady: () => true,
  },
}));
import {
  classifyCodeSdkError,
  parseClaudeProcessExitCode,
  remapCliFastfail,
} from "./codeSdkQuerySession";

describe("classifyCodeSdkError (official qwA)", () => {
  it("maps unsigned 3221226505 to cli_fastfail", () => {
    expect(classifyCodeSdkError("Claude Code process exited with code 3221226505")).toBe(
      "cli_fastfail",
    );
  });

  it("maps signed NTSTATUS -1073740791 to cli_fastfail", () => {
    expect(classifyCodeSdkError("Claude Code process exited with code -1073740791")).toBe(
      "cli_fastfail",
    );
  });

  it("maps A7i interrupt codes to process_interrupted", () => {
    expect(classifyCodeSdkError("Claude Code process exited with code 137")).toBe(
      "process_interrupted",
    );
    expect(classifyCodeSdkError("Claude Code process exited with code 3221225786")).toBe(
      "process_interrupted",
    );
    expect(classifyCodeSdkError("Claude Code process exited with code -1")).toBe(
      "process_interrupted",
    );
  });

  it("maps 3221225781 to dll_not_found", () => {
    expect(classifyCodeSdkError("Claude Code process exited with code 3221225781")).toBe(
      "dll_not_found",
    );
  });

  it("maps other nonzero exit codes to process_crashed", () => {
    expect(classifyCodeSdkError("Claude Code process exited with code 1")).toBe("process_crashed");
  });

  it("maps stderr Bun has crashed to bun_crash", () => {
    expect(
      classifyCodeSdkError("Claude Code process exited with code 1", "Bun has crashed\nstack"),
    ).toBe("bun_crash");
  });

  it("maps terminated by SIGTERM to process_interrupted", () => {
    expect(classifyCodeSdkError("Claude Code process terminated by signal SIGTERM")).toBe(
      "process_interrupted",
    );
  });

  it("maps prefixed resume-not-found to cli_resume_not_found", () => {
    expect(
      classifyCodeSdkError(
        "Claude Code returned an error result: No conversation found with session ID abc",
      ),
    ).toBe("cli_resume_not_found");
  });

  it("maps unprefixed prompt-too-long (handleResultMessage) to api_prompt_too_long", () => {
    expect(classifyCodeSdkError("prompt is too long")).toBe("api_prompt_too_long");
  });

  it("defaults unclassified messages to unknown", () => {
    expect(classifyCodeSdkError("some random failure")).toBe("unknown");
  });
});

describe("remapCliFastfail (official n7i)", () => {
  it("remaps cli_fastfail after a result to cli_shutdown_crash_benign", () => {
    expect(remapCliFastfail("cli_fastfail", true)).toBe("cli_shutdown_crash_benign");
  });

  it("keeps cli_fastfail when no result was seen", () => {
    expect(remapCliFastfail("cli_fastfail", false)).toBe("cli_fastfail");
  });

  it("does not remap other categories", () => {
    expect(remapCliFastfail("process_crashed", true)).toBe("process_crashed");
  });
});

describe("parseClaudeProcessExitCode", () => {
  it("parses unsigned and signed exit codes", () => {
    expect(parseClaudeProcessExitCode("Claude Code process exited with code 3221226505")).toBe(
      3221226505,
    );
    expect(parseClaudeProcessExitCode("Claude Code process exited with code -1073740791")).toBe(
      -1073740791,
    );
  });

  it("returns null when the message has no exit code", () => {
    expect(parseClaudeProcessExitCode("terminated by signal SIGKILL")).toBeNull();
  });
});
