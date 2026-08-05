import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listFramebufferSourcesFromCwd,
  listFramebufferSourcesIpc,
} from "./framebufferSourcesResidual";

async function withTempCwd(
  setup: (cwd: string) => Promise<void>,
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "fb-src-"));
  try {
    await setup(cwd);
    await run(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe("framebufferSourcesResidual", () => {
  it("empty cwd / missing configs → []", async () => {
    expect(await listFramebufferSourcesFromCwd("")).toEqual([]);
    expect(await listFramebufferSourcesFromCwd("/tmp/does-not-exist-fb")).toEqual(
      [],
    );
  });

  it("reads launch.json framebuffer entries only", async () => {
    await withTempCwd(
      async (cwd) => {
        await fs.mkdir(path.join(cwd, ".claude"), { recursive: true });
        await fs.writeFile(
          path.join(cwd, ".claude", "launch.json"),
          JSON.stringify({
            configurations: [
              {
                name: "vm",
                type: "framebuffer",
                vncUrl: "vnc://:secret@127.0.0.1:5901",
                serverFlavor: "vz",
              },
              {
                name: "node-server",
                type: "node",
                runtimeExecutable: "node",
                program: "server.js",
              },
              {
                name: "bad",
                type: "framebuffer",
                vncUrl: "http://not-vnc",
              },
            ],
          }),
        );
      },
      async (cwd) => {
        const list = await listFramebufferSourcesFromCwd(cwd);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
          name: "vm",
          vncUrl: "vnc://:secret@127.0.0.1:5901",
          serverFlavor: "vz",
        });
      },
    );
  });

  it("reads launch.d single-entry files", async () => {
    await withTempCwd(
      async (cwd) => {
        await fs.mkdir(path.join(cwd, ".claude", "launch.d"), { recursive: true });
        await fs.writeFile(
          path.join(cwd, ".claude", "launch.d", "guest.json"),
          JSON.stringify({
            name: "guest",
            type: "framebuffer",
            vncUrl: "vnc://127.0.0.1:5902",
          }),
        );
      },
      async (cwd) => {
        const ipc = await listFramebufferSourcesIpc(cwd);
        expect(ipc).toEqual([
          {
            name: "guest",
            vncUrl: "vnc://127.0.0.1:5902",
            serverFlavor: "standard",
          },
        ]);
      },
    );
  });

  it("never invents sources without files", async () => {
    await withTempCwd(
      async (cwd) => {
        await fs.mkdir(path.join(cwd, ".claude"), { recursive: true });
        await fs.writeFile(
          path.join(cwd, ".claude", "launch.json"),
          JSON.stringify({ configurations: [] }),
        );
      },
      async (cwd) => {
        expect(await listFramebufferSourcesFromCwd(cwd)).toEqual([]);
      },
    );
  });
});
