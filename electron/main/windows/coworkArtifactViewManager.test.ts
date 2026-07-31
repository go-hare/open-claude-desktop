import { describe, expect, it, vi } from "vitest";
import {
  buildCoworkArtifactUrl,
  listOfficialArtifactsOnDisk,
  normalizeCoworkArtifactRecord,
  resolveOfficialArtifactsRoot,
} from "./coworkArtifactViewManager";

describe("coworkArtifactViewManager residual helpers", () => {
  it("buildCoworkArtifactUrl matches official V2i", () => {
    expect(buildCoworkArtifactUrl("demo-id")).toBe("cowork-artifact://local/demo-id/index.html");
    expect(buildCoworkArtifactUrl("demo-id", 3)).toBe(
      "cowork-artifact://local/demo-id/versions/3.html",
    );
  });

  it("resolveOfficialArtifactsRoot uses Documents/Claude/Artifacts", () => {
    expect(resolveOfficialArtifactsRoot(() => "/Users/me/Documents")).toBe(
      "/Users/me/Documents/Claude/Artifacts",
    );
  });

  it("normalizeCoworkArtifactRecord fills uUt-ish fields", () => {
    const row = normalizeCoworkArtifactRecord({
      id: "a1",
      title: "Hello",
      createdAt: "2026-01-01T00:00:00.000Z",
      starred: true,
    });
    expect(row?.id).toBe("a1");
    expect(row?.name).toBe("Hello");
    expect(row?.isStarred).toBe(true);
    expect(typeof row?.createdAt).toBe("number");
  });

  it("normalizeCoworkArtifactRecord rejects missing id", () => {
    expect(normalizeCoworkArtifactRecord({ name: "x" })).toBeNull();
  });

  it("normalizeCoworkArtifactRecord never throws on null/undefined", () => {
    expect(normalizeCoworkArtifactRecord(null)).toBeNull();
    expect(normalizeCoworkArtifactRecord(undefined)).toBeNull();
  });

  it("listOfficialArtifactsOnDisk returns only folders with index.html", async () => {
    const readdir = vi.fn(async (p: string) => {
      if (String(p).endsWith("/versions")) {
        return [
          { name: "1700000000000.html", isFile: () => true },
          { name: "note.txt", isFile: () => true },
        ];
      }
      return [
        { name: "good", isDirectory: () => true },
        { name: "empty", isDirectory: () => true },
        { name: "file.txt", isDirectory: () => false },
        { name: ".hidden", isDirectory: () => true },
      ];
    });
    const access = vi.fn(async (p: string) => {
      if (String(p).endsWith("/good/index.html")) return;
      throw new Error("missing");
    });
    const stat = vi.fn(async () => ({ birthtimeMs: 1_700_000_000_000, mtimeMs: 1_700_000_000_000 }));
    const rows = await listOfficialArtifactsOnDisk(() => "/Users/me/Documents", {
      readdir: readdir as never,
      access: access as never,
      stat: stat as never,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("good");
    expect(String(rows[0]?.indexHtmlPath)).toContain("/Claude/Artifacts/good/index.html");
    expect(rows[0]?.versions).toEqual([1_700_000_000_000]);
  });

  it("listOfficialArtifactsOnDisk returns [] when root missing", async () => {
    const readdir = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    await expect(
      listOfficialArtifactsOnDisk(() => "/Users/me/Documents", { readdir: readdir as never }),
    ).resolves.toEqual([]);
  });
});
