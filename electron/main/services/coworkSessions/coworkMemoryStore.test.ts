import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteAccountMemory,
  listAccountMemories,
  readAccountMemory,
  readGlobalMemory,
  resetMemories,
  writeAccountMemory,
  writeGlobalMemory,
  type CoworkMemoryStoreDeps,
} from "./coworkMemoryStore";
import { coworkAccountStorageDir } from "./coworkAutoMemoryPaths";

let tmp: string | null = null;

afterEach(async () => {
  if (tmp) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    tmp = null;
  }
});

async function freshDeps(
  identity: { accountId: string; orgId: string } | null = {
    accountId: "acc",
    orgId: "org",
  },
): Promise<CoworkMemoryStoreDeps> {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-memory-"));
  return {
    userDataPath: tmp,
    resolveIdentity: () => identity,
  };
}

describe("coworkMemoryStore residual", () => {
  it("returns null/[]/false without identity — never invents", async () => {
    const deps = await freshDeps(null);
    expect(await readGlobalMemory(deps)).toBeNull();
    expect(await writeGlobalMemory(deps, "x")).toBe(false);
    expect(await listAccountMemories(deps)).toEqual([]);
    expect(await readAccountMemory(deps, "a.md")).toBeNull();
    expect(await writeAccountMemory(deps, "a.md", "x")).toBe(false);
    expect(await deleteAccountMemory(deps, "a.md")).toBe(false);
    expect(await resetMemories(deps)).toBe(false);
  });

  it("write/read global CLAUDE.md under AFA", async () => {
    const deps = await freshDeps();
    expect(await writeGlobalMemory(deps, "prefer concise")).toBe(true);
    expect(await readGlobalMemory(deps)).toBe("prefer concise");
    const root = coworkAccountStorageDir(deps.userDataPath, "acc", "org");
    const file = path.join(root, "memory", "CLAUDE.md");
    expect(await fs.readFile(file, "utf-8")).toBe("prefer concise");
  });

  it("lists account memories under GL, skips memory.md, newest first", async () => {
    const deps = await freshDeps();
    const root = coworkAccountStorageDir(deps.userDataPath, "acc", "org");
    const dir = path.join(root, "memory", "memory");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "memory.md"), "system", "utf-8");
    await fs.writeFile(path.join(dir, "alpha.md"), "---\nname: Alpha\n---\nA", "utf-8");
    // ensure beta is newer
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(path.join(dir, "beta.md"), "B", "utf-8");
    const list = await listAccountMemories(deps);
    expect(list.map((f) => f.path)).toEqual(["beta.md", "alpha.md"]);
    expect(list[1]?.content).toContain("Alpha");
  });

  it("writeAccountMemory only updates existing (official createIfMissing false)", async () => {
    const deps = await freshDeps();
    expect(await writeAccountMemory(deps, "new.md", "x")).toBe(false);
    const root = coworkAccountStorageDir(deps.userDataPath, "acc", "org");
    const dir = path.join(root, "memory", "memory");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "exist.md"), "old", "utf-8");
    expect(await writeAccountMemory(deps, "exist.md", "new")).toBe(true);
    expect(await readAccountMemory(deps, "exist.md")).toMatchObject({
      path: "exist.md",
      content: "new",
    });
  });

  it("deleteAccountMemory unlinks; rejects path traversal", async () => {
    const deps = await freshDeps();
    const root = coworkAccountStorageDir(deps.userDataPath, "acc", "org");
    const dir = path.join(root, "memory", "memory");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "gone.md"), "x", "utf-8");
    expect(await deleteAccountMemory(deps, "gone.md")).toBe(true);
    expect(await deleteAccountMemory(deps, "../escape.md")).toBe(false);
    expect(await listAccountMemories(deps)).toEqual([]);
  });

  it("resetMemories clears GL and space memory dirs", async () => {
    const deps = await freshDeps();
    const root = coworkAccountStorageDir(deps.userDataPath, "acc", "org");
    const gl = path.join(root, "memory", "memory");
    const spaceMem = path.join(root, "spaces", "sp1", "memory");
    await fs.mkdir(gl, { recursive: true });
    await fs.mkdir(spaceMem, { recursive: true });
    await fs.writeFile(path.join(gl, "a.md"), "1", "utf-8");
    await fs.writeFile(path.join(spaceMem, "b.md"), "2", "utf-8");
    expect(await resetMemories(deps)).toBe(true);
    expect(await listAccountMemories(deps)).toEqual([]);
    // dirs recreated empty
    const glEntries = await fs.readdir(gl).catch(() => [] as string[]);
    const spaceEntries = await fs.readdir(spaceMem).catch(() => [] as string[]);
    expect(glEntries).toEqual([]);
    expect(spaceEntries).toEqual([]);
  });
});
