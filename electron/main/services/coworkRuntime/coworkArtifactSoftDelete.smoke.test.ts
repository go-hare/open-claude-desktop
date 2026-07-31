/**
 * Smoke residual: official list soft-delete vs MCP create/list/update/restore.
 * Injected temp dirs only (no ~/Documents write).
 *
 * Official:
 * - list page: deleteArtifact(id) → bag only (removeFiles false)
 * - getAllWithDiskStatus: bag rows + ArtifactFolderMissing, no orphan re-import
 * - list_artifacts MCP: yn.getAllWithDiskStatus filtered missing (bag-first)
 * - create_artifact: disk + bag
 * - restoreVersion: versions/{n}.html → update(viaRestore)
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCoworkArtifactLocal,
  deleteCoworkArtifactLocal,
  getCoworkArtifactIndexHtmlPath,
  listCoworkArtifactsLocal,
  restoreCoworkArtifactVersionLocal,
  updateCoworkArtifactLocal,
} from "./coworkArtifactLocalStore";
import {
  COWORK_CREATE_ARTIFACT_TOOL,
  COWORK_LIST_ARTIFACTS_TOOL,
  createCoworkDirectoryMcpServerConfig,
} from "./coworkDirectoryMcpServer";

type Bag = Map<string, Record<string, unknown>>;

function makeFeatureState(bag: Bag) {
  return {
    loadMap: <T extends Record<string, unknown>>() => new Map(bag) as Map<string, T>,
    saveMap: <T extends Record<string, unknown>>(_key: string, map: Map<string, T>) => {
      bag.clear();
      for (const [k, v] of map) bag.set(k, v as Record<string, unknown>);
    },
  };
}

type RegisteredTool = {
  handler: (
    args: Record<string, unknown>,
    extra?: unknown,
  ) => Promise<{
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
};

function registeredTools(server: unknown): Record<string, RegisteredTool> {
  const record = server as {
    instance?: { _registeredTools?: Record<string, RegisteredTool> };
    tools?: Array<{ name: string; handler: RegisteredTool["handler"] }>;
  };
  if (record.instance?._registeredTools) {
    return record.instance._registeredTools;
  }
  const map: Record<string, RegisteredTool> = {};
  for (const tool of record.tools ?? []) {
    map[tool.name] = { handler: tool.handler };
  }
  return map;
}

describe("artifact soft-delete residual smoke", () => {
  let root: string;
  let docs: string;
  let bag: Bag;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-artifact-smoke-"));
    docs = path.join(root, "Documents");
    await fs.mkdir(path.join(docs, "Claude", "Artifacts"), { recursive: true });
    bag = new Map();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it("create → soft-delete bag → disk orphan remains → slug blocked → hard remove", async () => {
    const deps = {
      getDocumentsPath: () => docs,
      featureState: makeFeatureState(bag) as never,
    };

    const created = await createCoworkArtifactLocal(
      "smoke-board",
      "<!DOCTYPE html><html><body><h1>v1</h1></body></html>",
      { description: "smoke", createdBySessionId: "sess-1" },
      deps,
    );
    expect(created.id).toBe("smoke-board");
    expect(bag.has("smoke-board")).toBe(true);

    const indexPath = getCoworkArtifactIndexHtmlPath("smoke-board", () => docs);
    await fs.access(indexPath);

    expect((await listCoworkArtifactsLocal(deps)).some((r) => r.id === "smoke-board")).toBe(
      true,
    );

    // Soft-delete bag only (list page residual)
    expect(
      await deleteCoworkArtifactLocal("smoke-board", { removeFiles: false }, deps),
    ).toBe(true);
    expect(bag.has("smoke-board")).toBe(false);

    // Disk orphan remains
    await fs.access(indexPath);

    // Soft-delete again → false (missing bag)
    await expect(
      deleteCoworkArtifactLocal("smoke-board", { removeFiles: false }, deps),
    ).resolves.toBe(false);

    // Orphan blocks same slug create (official isSlugTaken disk check)
    await expect(
      createCoworkArtifactLocal(
        "smoke-board",
        "<!DOCTYPE html><html><body>x</body></html>",
        {},
        deps,
      ),
    ).rejects.toThrow(/already exists/);

    // removeFiles true clears orphan (import-fail residual)
    expect(
      await deleteCoworkArtifactLocal("smoke-board", { removeFiles: true }, deps),
    ).toBe(true);
    await expect(fs.access(indexPath)).rejects.toThrow();
  });

  it("update snapshots version; restore rewrites index without new snapshot", async () => {
    const deps = {
      getDocumentsPath: () => docs,
      featureState: makeFeatureState(bag) as never,
    };

    await createCoworkArtifactLocal(
      "ver-demo",
      "<!DOCTYPE html><html><body>old</body></html>",
      {},
      deps,
    );
    const afterUpdate = await updateCoworkArtifactLocal(
      "ver-demo",
      "<!DOCTYPE html><html><body>new</body></html>",
      { description: "updated" },
      deps,
    );
    const versions = Array.isArray(afterUpdate.versions)
      ? (afterUpdate.versions as number[])
      : [];
    expect(versions.length).toBeGreaterThan(0);
    const stamp = versions[0]!;

    await fs.access(
      path.join(docs, "Claude", "Artifacts", "ver-demo", "versions", `${stamp}.html`),
    );

    expect(await restoreCoworkArtifactVersionLocal("ver-demo", stamp, deps)).toBe(true);

    const indexHtml = await fs.readFile(
      getCoworkArtifactIndexHtmlPath("ver-demo", () => docs),
      "utf8",
    );
    expect(indexHtml).toContain("old");

    const row = bag.get("ver-demo");
    const afterRestoreVersions = Array.isArray(row?.versions)
      ? (row!.versions as number[])
      : [];
    expect(afterRestoreVersions).toEqual(versions);
  });

  it("MCP create_artifact writes bag; list_artifacts bag-first hides soft-delete", async () => {
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    const htmlPath = path.join(workspace, "board.html");
    await fs.writeFile(
      htmlPath,
      "<!DOCTYPE html><html><body><h1>MCP Board</h1></body></html>",
      "utf8",
    );

    let changed = 0;
    const deps = {
      getDocumentsPath: () => docs,
      featureState: makeFeatureState(bag) as never,
    };
    const server = createCoworkDirectoryMcpServerConfig({
      hasArtifacts: true,
      artifactStoreDeps: deps,
      onArtifactsChanged: () => {
        changed++;
      },
      sessionId: "s-smoke",
      vmProcessName: "vm-smoke",
    });
    const tools = registeredTools(server);

    const createResult = await tools[COWORK_CREATE_ARTIFACT_TOOL].handler({
      id: "mcp-board",
      html_path: htmlPath,
      description: "from mcp",
    });
    expect(createResult.isError).toBeUndefined();
    expect(createResult.content[0]?.text).toContain('Artifact "mcp-board" created');
    expect(changed).toBe(1);
    expect(bag.has("mcp-board")).toBe(true);

    const listBefore = await tools[COWORK_LIST_ARTIFACTS_TOOL].handler({});
    expect(listBefore.content[0]?.text).toContain("mcp-board");

    // Soft-delete bag — official list_artifacts should hide (bag-first + missing filter)
    await deleteCoworkArtifactLocal("mcp-board", { removeFiles: false }, deps);
    expect(bag.has("mcp-board")).toBe(false);

    const listAfterSoft = await tools[COWORK_LIST_ARTIFACTS_TOOL].handler({});
    expect(listAfterSoft.content[0]?.text).toContain("No artifacts found");

    // Disk orphan still present until hard remove
    await fs.access(getCoworkArtifactIndexHtmlPath("mcp-board", () => docs));

    await deleteCoworkArtifactLocal("mcp-board", { removeFiles: true }, deps);
    await expect(
      fs.access(getCoworkArtifactIndexHtmlPath("mcp-board", () => docs)),
    ).rejects.toThrow();
  });
});
