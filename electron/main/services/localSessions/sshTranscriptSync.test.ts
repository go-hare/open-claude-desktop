import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { clearCodeTranscriptCaches, mangleCodeProjectDir } from "./codeTranscriptJsonl";
import {
  clearSshTranscriptSyncState,
  fetchRemoteTranscript,
  getLocalSSHTranscriptPath,
  persistSSHTranscript,
  shellQuote,
  type SessionSshConfig,
  type SshExecResult,
  type SshTranscriptSession,
} from "./sshTranscriptSync";

const tempDirs: string[] = [];

afterEach(() => {
  clearCodeTranscriptCaches();
  clearSshTranscriptSyncState();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

it("shellQuote: wraps and escapes single quotes", () => {
  expect(shellQuote("abc")).toBe("'abc'");
  expect(shellQuote("a'b")).toBe(`'a'"'"'b'`);
});

it("persistSSHTranscript + fetchRemoteTranscript: byte-sync mirror then parse", async () => {
  const remoteRoot = tempDir("ssh-remote-");
  const localConfig = tempDir("ssh-local-claude-");
  const remoteCwd = "/home/u/proj";
  const remoteProject = path.join(remoteRoot, "projects", mangleCodeProjectDir(remoteCwd));
  fs.mkdirSync(remoteProject, { recursive: true });
  const cliSessionId = "ssh-sess-1";
  const remoteJsonl = path.join(remoteProject, `${cliSessionId}.jsonl`);

  const line1 = JSON.stringify({
    type: "user",
    cwd: remoteCwd,
    timestamp: "2026-07-27T01:00:00.000Z",
    message: { role: "user", content: "hello-ssh" },
  });
  const line2 = JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-27T01:00:01.000Z",
    message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
  });
  fs.writeFileSync(remoteJsonl, `${line1}\n`, "utf8");

  // Fake remote FS: interpret find / head / tail / ls against the temp remote tree.
  const execSsh = async (_config: SessionSshConfig, remoteCommand: string): Promise<SshExecResult> => {
    if (remoteCommand.includes("find ")) {
      return { stdout: `${remoteJsonl}\n`, stderr: "", exitCode: 0 };
    }
    if (remoteCommand.includes("head -n1 ")) {
      const first = fs.readFileSync(remoteJsonl, "utf8").split(/\n/)[0] ?? "";
      return { stdout: `${first}\n`, stderr: "", exitCode: 0 };
    }
    if (remoteCommand.includes("tail -c +")) {
      const offsetMatch = remoteCommand.match(/tail -c \+(\d+)/);
      const offset = Math.max(0, Number(offsetMatch?.[1] ?? 1) - 1);
      // Main transcript vs agent files: prefer remoteJsonl when command references it or find path.
      const file = remoteCommand.includes("agent-")
        ? null
        : remoteJsonl;
      if (!file) return { stdout: "", stderr: "", exitCode: 0 };
      const buf = fs.readFileSync(file);
      return { stdout: buf.subarray(offset).toString("utf8"), stderr: "", exitCode: 0 };
    }
    if (remoteCommand.includes("ls -1 ")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: `unhandled: ${remoteCommand}`, exitCode: 1 };
  };

  const sshConfig: SessionSshConfig = { host: "devbox" };
  const session: SshTranscriptSession = {
    sessionId: "local-1",
    cliSessionId,
    sshConfig,
  };
  const patches: Array<Partial<SshTranscriptSession>> = [];

  await persistSSHTranscript(session, {
    configDir: localConfig,
    execSsh,
    onSessionPatch: (patch) => {
      Object.assign(session, patch);
      patches.push(patch);
    },
  });

  const mirror = getLocalSSHTranscriptPath(cliSessionId, localConfig);
  expect(fs.existsSync(mirror)).toBe(true);
  expect(fs.readFileSync(mirror, "utf8")).toContain("hello-ssh");
  expect(session.sshLocalTranscriptSize).toBeGreaterThan(0);

  // Append remotely and incremental-sync.
  fs.appendFileSync(remoteJsonl, `${line2}\n`, "utf8");
  await persistSSHTranscript(session, {
    configDir: localConfig,
    execSsh,
    onSessionPatch: (patch) => Object.assign(session, patch),
  });
  expect(fs.readFileSync(mirror, "utf8")).toContain('"text":"hi"');

  const events = await fetchRemoteTranscript(session, {
    configDir: localConfig,
    execSsh,
    onSessionPatch: (patch) => Object.assign(session, patch),
  });
  expect(events.map((e) => (e as { type: string }).type)).toEqual(["user", "assistant"]);
  expect(patches.length).toBeGreaterThan(0);
});
