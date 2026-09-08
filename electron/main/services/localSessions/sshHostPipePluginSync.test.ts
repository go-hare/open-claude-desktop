import { describe, expect, it } from "vitest";
import {
  buildScpArgv,
  createHostPipeRemotePluginSyncController,
  rewriteCcdPluginsForSsh,
} from "./sshHostPipePluginSync";
import type { RemotePluginSyncController } from "./remotePluginSync";

describe("sshHostPipePluginSync (official _Cr host-pipe surface)", () => {
  it("scp argv uses -P for port and BatchMode", () => {
    expect(
      buildScpArgv(
        { host: "box", user: "me", port: 2222, identityFile: "/tmp/id" },
        "/tmp/a.tar.gz",
        ".claude/remote/plugins/a.tar.gz",
      ),
    ).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "-i",
      "/tmp/id",
      "-P",
      "2222",
      "/tmp/a.tar.gz",
      "me@box:.claude/remote/plugins/a.tar.gz",
    ]);
  });

  it("rewrites local plugin paths to remote hash dirs", async () => {
    const rewritten = await rewriteCcdPluginsForSsh(
      [{ type: "local", path: "/tmp/plug" }],
      { host: "box" },
      {
        createController: async () =>
          ({
            remoteHome: "/home/u",
            statFile: async () => ({ exists: true }),
            withSftp: async () => undefined,
            extractTar: async () => ({ success: true }),
          }) satisfies RemotePluginSyncController,
        sync: async (_controller, roots) => {
          const map = new Map<string, string>();
          for (const root of roots) map.set(root, `/home/u/.claude/remote/plugins/deadbeef`);
          return map;
        },
      },
    );
    expect(rewritten).toEqual([
      { type: "local", path: "/home/u/.claude/remote/plugins/deadbeef" },
    ]);
  });

  it("fastPut scp uses remoteHome-absolute path (same as extractTar)", async () => {
    const puts: string[] = [];
    const controller = await createHostPipeRemotePluginSyncController(
      { host: "box" },
      {
        execSsh: async (_config, command) => {
          if (command.includes("HOME")) {
            return { exitCode: 0, stdout: "/home/u\n", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        scp: async (_config, _local, remote) => {
          puts.push(remote);
        },
      },
    );
    await controller.withSftp(async (sftp) => {
      await sftp.fastPut(
        "/tmp/a.tar.gz",
        ".claude/remote/plugins/deadbeef.tar.gz",
        { mode: 0o600 },
      );
    });
    expect(puts).toEqual(["/home/u/.claude/remote/plugins/deadbeef.tar.gz"]);
  });

  it("drops plugins when sync throws (official catch → delete A.plugins)", async () => {
    const rewritten = await rewriteCcdPluginsForSsh(
      [{ type: "local", path: "/tmp/plug" }],
      { host: "box" },
      {
        createController: async () => {
          throw new Error("ssh down");
        },
      },
    );
    expect(rewritten).toBeUndefined();
  });
});
