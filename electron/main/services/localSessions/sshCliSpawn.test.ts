import { expect, it } from "vitest";
import {
  buildRemoteClaudeShellCommand,
  filterRemoteClaudeEnv,
  resolveSshRemoteCwd,
} from "./sshCliSpawn";
import { buildSshArgv, normalizeSessionSshConfig, shellQuote } from "./sshTranscriptSync";

it("filterRemoteClaudeEnv: keeps CLAUDE_/ANTHROPIC_/DISABLE_AUTOUPDATER, drops host-only", () => {
  const filtered = filterRemoteClaudeEnv({
    CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
    ANTHROPIC_BASE_URL: "https://gw.example",
    ANTHROPIC_API_KEY: "sk-test",
    DISABLE_AUTOUPDATER: "1",
    PATH: "/usr/bin",
    HOME: "/Users/me",
    CLAUDE_CODE_HOST_FOO: "x",
    CLAUDE_CODE_SSE_PORT: "1234",
    CLAUDE_CONFIG_DIR: "/tmp/x",
    SOME_FILE_DESCRIPTOR: "3",
    CLAUDE_FOO_FILE_DESCRIPTOR: "9",
  });
  expect(filtered).toEqual({
    CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
    ANTHROPIC_BASE_URL: "https://gw.example",
    ANTHROPIC_API_KEY: "sk-test",
    DISABLE_AUTOUPDATER: "1",
  });
});

it("buildRemoteClaudeShellCommand: cd + env + claude args", () => {
  const cmd = buildRemoteClaudeShellCommand({
    remoteCwd: "/home/u/proj",
    remoteExecutable: "claude",
    args: ["--print", "--output-format", "stream-json"],
    env: { ANTHROPIC_API_KEY: "sk'x" },
  });
  expect(cmd.startsWith("cd /home/u/proj && env ")).toBe(true);
  expect(cmd).toContain("ANTHROPIC_API_KEY=");
  expect(cmd).toContain("claude --print --output-format stream-json");
  // single-quote escape for apostrophe in key value
  expect(cmd).toContain(shellQuote("sk'x"));
});

it("normalizeSessionSshConfig: official sshHost shape + product host shape", () => {
  const official = normalizeSessionSshConfig({
    sshHost: "devbox",
    sshPort: 2222,
    sshIdentityFile: "/tmp/id",
    remoteCwd: "/home/u/app",
  });
  expect(official?.host).toBe("devbox");
  expect(official?.port).toBe(2222);
  expect(official?.identityFile).toBe("/tmp/id");
  expect(official?.remoteCwd).toBe("/home/u/app");

  const product = normalizeSessionSshConfig({ host: "box", user: "me", port: 22 });
  expect(product?.host).toBe("box");
  expect(product?.user).toBe("me");
  expect(product?.sshHost).toBe("box");
});

it("buildSshArgv: batch + forceTty", () => {
  const config = normalizeSessionSshConfig({ host: "dev", user: "u", port: 22 })!;
  const batch = buildSshArgv(config, "true", { batchMode: true });
  expect(batch).toContain("BatchMode=yes");
  expect(batch).toContain("u@dev");
  expect(batch[batch.length - 1]).toBe("true");

  const tty = buildSshArgv(config, undefined, { batchMode: false, forceTty: true });
  expect(tty).toContain("-tt");
  expect(tty).not.toContain("BatchMode=yes");
});

it("resolveSshRemoteCwd: remoteCwd > worktreePath > cwd", () => {
  expect(
    resolveSshRemoteCwd({
      sshConfig: { host: "h", remoteCwd: "/r" },
      worktreePath: "/w",
      cwd: "/c",
    }),
  ).toBe("/r");
  expect(resolveSshRemoteCwd({ worktreePath: "/w", cwd: "/c" })).toBe("/w");
  expect(resolveSshRemoteCwd({ cwd: "/c" })).toBe("/c");
  expect(resolveSshRemoteCwd({})).toBe("~");
});
