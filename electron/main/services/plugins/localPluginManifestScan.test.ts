import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listPluginSkillFiles, scanPluginManifest } from "./localPluginManifestScan";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-scan-"));
  temps.push(dir);
  return dir;
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("scanPluginManifest (official Aye/fsr)", () => {
  it("always returns skills/mcpServers/hooks/agents arrays for kSA", () => {
    const root = mkDir();
    write(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "demo" }),
    );
    const scanned = scanPluginManifest({
      id: "demo-plugin@local-desktop-app-uploads",
      name: "demo-plugin",
      installPath: root,
      enabled: true,
      scope: "user",
    });
    expect(scanned).not.toBeNull();
    expect(scanned?.skills).toEqual([]);
    expect(scanned?.mcpServers).toEqual([]);
    expect(scanned?.hooks).toEqual([]);
    expect(scanned?.agents).toEqual([]);
    expect(scanned?.scope).toBe("user");
    expect(scanned?.description).toBe("demo");
  });

  it("scans skills/*/SKILL.md and agents/*.md", () => {
    const root = mkDir();
    write(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "pack" }),
    );
    write(
      path.join(root, "skills", "greet", "SKILL.md"),
      "---\nname: greet\ndescription: Say hi\n---\nHello\n",
    );
    write(
      path.join(root, "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews diffs\n---\nBe thorough\n",
    );
    write(path.join(root, "README.md"), "# pack\n");
    const scanned = scanPluginManifest({
      id: "pack@local-desktop-app-uploads",
      name: "pack",
      installPath: root,
    });
    expect(scanned?.skills.map((s) => s.name)).toEqual(["pack:greet"]);
    expect(scanned?.skills[0]?.source).toBe("skills");
    expect(scanned?.agents.map((a) => a.name)).toEqual(["pack:reviewer"]);
    expect(scanned?.readmePath).toBe(path.join(root, "README.md"));
    const files = listPluginSkillFiles(scanned!, "pack:greet");
    expect(files.some((file) => file.path === "SKILL.md")).toBe(true);
  });
});
