import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalLaunchManager,
  parseLaunchConfiguration,
  readLaunchJsonConfigurations,
} from "./localLaunchManager";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mkCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-mgr-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseLaunchConfiguration (official buildCommand residual)", () => {
  it("builds runtimeExecutable + runtimeArgs", () => {
    const cfg = parseLaunchConfiguration(
      {
        name: "web",
        runtimeExecutable: "npm",
        runtimeArgs: ["run", "dev"],
        port: 5176,
      },
      "/proj",
      0,
    );
    expect(cfg).toEqual({
      name: "web",
      port: 5176,
      command: "npm",
      args: ["run", "dev"],
      cwd: "/proj",
    });
  });

  it("returns null without executable/program", () => {
    expect(parseLaunchConfiguration({ name: "x" }, "/proj", 0)).toBeNull();
  });
});

describe("readLaunchJsonConfigurations / getConfiguredServices residual", () => {
  it("returns empty when launch.json missing (no package.json invent)", async () => {
    const cwd = mkCwd();
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", start: "node server.js" } }),
    );
    expect(await readLaunchJsonConfigurations(cwd)).toEqual([]);
    const mgr = new LocalLaunchManager();
    expect(await mgr.getConfiguredServices(cwd)).toEqual([]);
    expect(await mgr.startFromConfig(cwd)).toEqual({});
  });

  it("reads .claude/launch.json configurations", async () => {
    const cwd = mkCwd();
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({
        version: "0.0.1",
        configurations: [
          {
            name: "vite",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev"],
            port: 5176,
          },
        ],
      }),
    );
    const cfgs = await readLaunchJsonConfigurations(cwd);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]?.name).toBe("vite");
    expect(cfgs[0]?.port).toBe(5176);
    const mgr = new LocalLaunchManager();
    expect(await mgr.getConfiguredServices(cwd)).toEqual([{ name: "vite", port: 5176 }]);
  });

  it("gates startFromConfig/startCommand when launchEnabled is false", async () => {
    const cwd = mkCwd();
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({
        configurations: [
          {
            name: "vite",
            runtimeExecutable: "npm",
            runtimeArgs: ["run", "dev"],
            port: 5176,
          },
        ],
      }),
    );
    const mgr = new LocalLaunchManager();
    mgr.setLaunchEnabledReader(() => false);
    expect(mgr.isEnabled()).toBe(false);
    // Config still readable (UI residual); start hard-gated.
    expect(await mgr.getConfiguredServices(cwd)).toEqual([{ name: "vite", port: 5176 }]);
    expect(await mgr.startFromConfig(cwd, "vite")).toEqual({
      error: "launch_disabled",
    });
    expect(
      await mgr.startCommand(cwd, "x", "echo", ["hi"], 3000),
    ).toEqual({ error: "launch_disabled" });
  });

  it("skips framebuffer entries", async () => {
    const cwd = mkCwd();
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".claude", "launch.json"),
      JSON.stringify({
        configurations: [
          { name: "fb", type: "framebuffer", vncUrl: "vnc://localhost:5900" },
          { name: "web", runtimeExecutable: "node", runtimeArgs: ["server.js"], port: 3000 },
        ],
      }),
    );
    const cfgs = await readLaunchJsonConfigurations(cwd);
    expect(cfgs.map((c) => c.name)).toEqual(["web"]);
  });
});
