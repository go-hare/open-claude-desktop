import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { addCoworkSessionFolder } from "./coworkSessionWorkspace";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function session(): CoworkSessionRuntimeState {
  return {
    createdAt: 1,
    cwd: "/sessions/test",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isFirstTurn: false,
    lastActivityAt: 1,
    lifecycleState: "idle",
    messageBuffer: [],
    pendingNotifications: [],
    processName: "test",
    query: null,
    resolvedFolders: [],
    sessionId: "session-1",
    vmProcessName: "test",
  };
}

it("canonicalizes and deduplicates a selected folder", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "cowork-folder-"));
  const state = session();
  try {
    const canonical = await realpath(folder);
    await expect(addCoworkSessionFolder(state, folder)).resolves.toEqual({
      folderPath: canonical,
      ok: true,
    });
    await addCoworkSessionFolder(state, `${folder}${path.sep}`);
    expect(state.resolvedFolders).toEqual([
      { canonical, display: canonical, kind: "local" },
    ]);
  } finally {
    await rm(folder, { force: true, recursive: true });
  }
});

it("rejects unresolved and relative folders", async () => {
  const state = session();

  await expect(addCoworkSessionFolder(state, "relative/path")).resolves.toEqual({
    error: "Folder path must be absolute",
    ok: false,
  });
  await expect(
    addCoworkSessionFolder(state, "/definitely/missing/cowork-folder"),
  ).resolves.toEqual({ error: "Folder could not be resolved", ok: false });
});
