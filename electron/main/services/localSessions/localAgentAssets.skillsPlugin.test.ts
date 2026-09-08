import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteLocalSkill,
  getSkillsPluginPath,
  listLocalSkills,
  resetSkillsPluginTestHooks,
  sanitizeSkillsPluginName,
  saveLocalSkill,
  setLocalSkillEnabled,
  setSkillsPluginTestHooks,
} from "./localAgentAssets";

describe("SkillsPlugin CUi residual (official asar CUi)", () => {
  let root = "";

  afterEach(async () => {
    resetSkillsPluginTestHooks();
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  async function withPlugin() {
    root = await mkdtemp(path.join(os.tmpdir(), "skills-plugin-"));
    setSkillsPluginTestHooks({
      getUserDataPath: () => root,
      resolveIdentity: async () => ({
        organizationUuid: "org-1",
        accountUuid: "acct-1",
      }),
    });
    return path.join(
      root,
      "local-agent-mode-sessions",
      "skills-plugin",
      "org-1",
      "acct-1",
    );
  }

  it("sanitizeSkillName replaces invalid path chars", () => {
    expect(sanitizeSkillsPluginName('a<>"|?*\\/b')).toBe("a________b");
  });

  it("getPluginPath is null until skills/ has files, then returns plugin root", async () => {
    const pluginDir = await withPlugin();
    expect(await getSkillsPluginPath()).toBeNull();
    await saveLocalSkill(
      "weekly-status-report",
      "Summarize work.",
      '---\nname: "weekly-status-report"\ndescription: "Summarize work."\n---\n\nDo it.\n',
      false,
    );
    expect(await getSkillsPluginPath()).toBe(pluginDir);
  });

  it("saveLocalSkill writes SKILL.md under userData/local-agent-mode-sessions/skills-plugin/{org}/{account}/skills", async () => {
    const pluginDir = await withPlugin();
    const result = await saveLocalSkill(
      "weekly-status-report",
      "Summarize work.",
      '---\nname: "weekly-status-report"\ndescription: "Summarize work."\n---\n\nDo it.\n',
      false,
    );
    expect(result).toEqual({ ok: true });
    const md = await readFile(
      path.join(pluginDir, "skills", "weekly-status-report", "SKILL.md"),
      "utf8",
    );
    expect(md).toContain("Do it.");
    const manifest = JSON.parse(
      await readFile(path.join(pluginDir, "manifest.json"), "utf8"),
    ) as { skills: Array<{ creatorType: string; name: string }> };
    expect(manifest.skills).toEqual([
      expect.objectContaining({
        name: "weekly-status-report",
        creatorType: "user",
      }),
    ]);
    expect(await listLocalSkills()).toEqual([
      expect.objectContaining({
        skillId: "weekly-status-report",
        name: "weekly-status-report",
        enabled: true,
      }),
    ]);
  });

  it("does not write into ~/.claude/skills and rejects overwrite unless requested", async () => {
    await withPlugin();
    await saveLocalSkill("demo", "d", "---\nname: demo\ndescription: d\n---\n\nx\n", false);
    await expect(
      saveLocalSkill("demo", "d", "---\nname: demo\ndescription: d\n---\n\ny\n", false),
    ).resolves.toEqual({ ok: false, error: "already_exists" });
    await expect(
      saveLocalSkill("schedule", "d", "---\nname: schedule\ndescription: d\n---\n\nx\n", false),
    ).resolves.toEqual({ ok: false, error: '"schedule" is a built-in skill name' });
  });

  it("setLocalSkillEnabled and deleteLocalSkill stay in plugin dir", async () => {
    const pluginDir = await withPlugin();
    await saveLocalSkill("demo", "d", "---\nname: demo\ndescription: d\n---\n\nx\n", false);
    await expect(setLocalSkillEnabled("demo", false)).resolves.toEqual({ ok: true });
    const listed = await listLocalSkills();
    expect(listed[0]?.enabled).toBe(false);
    await expect(deleteLocalSkill("demo")).resolves.toEqual({ ok: true });
    expect(await listLocalSkills()).toEqual([]);
    await expect(
      readFile(path.join(pluginDir, "skills", "demo", "SKILL.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("migrates leftover userData/local-skills into the plugin tree", async () => {
    const pluginDir = await withPlugin();
    const legacy = path.join(root, "local-skills", "legacy-skill");
    await mkdir(legacy, { recursive: true });
    await writeFile(
      path.join(legacy, "SKILL.md"),
      "---\nname: legacy-skill\ndescription: old\n---\n\nbody\n",
    );
    const listed = await listLocalSkills();
    expect(listed.map((skill) => skill.name)).toContain("legacy-skill");
    const md = await readFile(
      path.join(pluginDir, "skills", "legacy-skill", "SKILL.md"),
      "utf8",
    );
    expect(md).toContain("body");
  });
});
