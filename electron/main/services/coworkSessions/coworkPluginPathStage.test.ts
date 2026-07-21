import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveCoworkHostloopPluginsStagingDir,
  stageCoworkPluginPathIfNeeded,
  stageCoworkPluginPaths,
} from "./coworkPluginPathStage";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-kk-"));
  tempDirs.push(dir);
  return dir;
}

describe("stageCoworkPluginPathIfNeeded (kK residual)", () => {
  it("passes through paths without spaces", () => {
    expect(stageCoworkPluginPathIfNeeded("/tmp/plugins/foo")).toBe(
      "/tmp/plugins/foo",
    );
  });

  it("does not invent staged path for missing target", () => {
    const missing = path.join(mkTemp(), "has space", "missing");
    expect(stageCoworkPluginPathIfNeeded(missing)).toBe(missing);
  });

  it("stages existing space path under claude-hostloop-plugins", () => {
    const root = mkTemp();
    const plugin = path.join(root, "My Plugins", "tool");
    fs.mkdirSync(plugin, { recursive: true });
    const stagingTmp = mkTemp();
    const staged = stageCoworkPluginPathIfNeeded(plugin, {
      tmpdir: stagingTmp,
    });
    expect(staged).not.toBe(plugin);
    expect(staged).not.toContain(" ");
    expect(staged.startsWith(resolveCoworkHostloopPluginsStagingDir(stagingTmp)))
      .toBe(true);
    expect(fs.readlinkSync(staged)).toBe(plugin);
  });

  it("reuses existing correct symlink", () => {
    const root = mkTemp();
    const plugin = path.join(root, "space dir", "p");
    fs.mkdirSync(plugin, { recursive: true });
    const stagingTmp = mkTemp();
    const a = stageCoworkPluginPathIfNeeded(plugin, { tmpdir: stagingTmp });
    const b = stageCoworkPluginPathIfNeeded(plugin, { tmpdir: stagingTmp });
    expect(a).toBe(b);
  });
});

describe("stageCoworkPluginPaths", () => {
  it("appends HeA staging root when any path was staged", () => {
    const root = mkTemp();
    const plugin = path.join(root, "space name", "x");
    fs.mkdirSync(plugin, { recursive: true });
    const stagingTmp = mkTemp();
    const out = stageCoworkPluginPaths([plugin, "/tmp/plain"], {
      tmpdir: stagingTmp,
      existsSync: (p) => {
        if (p === "/tmp/plain") return true;
        return fs.existsSync(p);
      },
    });
    const stagingRoot = resolveCoworkHostloopPluginsStagingDir(stagingTmp);
    expect(out.some((p) => p === stagingRoot)).toBe(true);
    expect(out.some((p) => p.includes(" "))).toBe(false);
  });
});
