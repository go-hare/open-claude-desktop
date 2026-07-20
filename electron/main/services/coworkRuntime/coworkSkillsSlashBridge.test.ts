import { afterEach, expect, it } from "vitest";
import {
  clearCoworkSkillsSlashBridgeForTests,
  resolveCoworkSlashMenuSkills,
  respondCoworkSlashMenuSkills,
  searchCoworkAddableSkills,
  setCoworkSkillsSlashBridgeDispatcher,
} from "./coworkSkillsSlashBridge";

afterEach(() => {
  clearCoworkSkillsSlashBridgeForTests();
});

it("resolves slash_menu_skills_resolve when web responds", async () => {
  setCoworkSkillsSlashBridgeDispatcher({
    emit: (event) => {
      expect(event.type).toBe("slash_menu_skills_resolve");
      const payload = JSON.parse(event.data) as {
        requestId: string;
        skillNames: string[];
      };
      expect(payload.skillNames).toEqual(["git"]);
      respondCoworkSlashMenuSkills(
        payload.requestId,
        JSON.stringify([
          { name: "git", description: "Git helpers", skillId: "s1" },
        ]),
      );
    },
  });
  const skills = await resolveCoworkSlashMenuSkills("sid", ["git"], []);
  expect(skills).toEqual([
    {
      argumentHint: undefined,
      description: "Git helpers",
      isUserCreated: undefined,
      name: "git",
      skillId: "s1",
    },
  ]);
});

it("resolves addable_skills_search reverse-RPC", async () => {
  setCoworkSkillsSlashBridgeDispatcher({
    emit: (event) => {
      expect(event.type).toBe("addable_skills_search");
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkSlashMenuSkills(payload.requestId, [
        { name: "docs", description: "Docs", isUserCreated: true },
      ]);
    },
  });
  const skills = await searchCoworkAddableSkills("sid", ["docs"]);
  expect(skills[0]?.name).toBe("docs");
  expect(skills[0]?.isUserCreated).toBe(true);
});

it("returns empty when dispatcher missing", async () => {
  const skills = await resolveCoworkSlashMenuSkills("sid", [], []);
  expect(skills).toEqual([]);
});

it("ignores malformed skill entries", async () => {
  setCoworkSkillsSlashBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkSlashMenuSkills(payload.requestId, [
        null,
        { name: 1 },
        { name: "ok", description: "d" },
      ]);
    },
  });
  const skills = await resolveCoworkSlashMenuSkills("sid", undefined, undefined);
  expect(skills.map((s) => s.name)).toEqual(["ok"]);
});
