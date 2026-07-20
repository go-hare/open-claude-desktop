import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  COWORK_NETWORK_DRIVE_SANDBOX_DENY,
  addCoworkSessionFolder,
  addCoworkSessionResolvedFolder,
  coworkFolderPermissionPaths,
  coworkNetworkDriveFolderPaths,
  coworkPathKindToResolvedFolder,
  coworkUserSelectedFolderPaths,
  filterCoworkDraftSessionFolders,
  isCoworkResumeResolvablePathKind,
  mountCoworkSessionFolderFromPathKind,
  resolveAndFilterCoworkSessionFolders,
} from "./coworkSessionWorkspace";
import type { CoworkPathKind } from "../coworkRuntime/coworkDirectoryMcpServer";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function session(
  overrides: Partial<CoworkSessionRuntimeState> = {},
): CoworkSessionRuntimeState {
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
    ...overrides,
  };
}

it("canonicalizes and deduplicates a selected folder", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "cowork-folder-"));
  const state = session();
  try {
    const canonical = await realpath(folder);
    // Official Mh: display = normalize(input); canonical = realpath; Lc → canonical.
    await expect(addCoworkSessionFolder(state, folder)).resolves.toEqual({
      folderPath: canonical,
      ok: true,
      networkDrive: false,
    });
    await addCoworkSessionFolder(state, `${folder}${path.sep}`);
    expect(state.resolvedFolders).toHaveLength(1);
    expect(state.resolvedFolders[0]).toMatchObject({
      kind: "local",
      canonical,
    });
    expect(state.resolvedFolders[0]?.display).toBe(path.normalize(folder));
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

it("implements official _c / NH / Zni folder path helpers", () => {
  const local = {
    kind: "local" as const,
    display: "/Users/a/Projects",
    canonical: "/Users/a/Projects",
  };
  const net = {
    kind: "network-drive" as const,
    display: "Z:/share",
    unc: "\\\\server\\share",
  };
  expect(coworkUserSelectedFolderPaths([local, net])).toEqual([
    "/Users/a/Projects",
    "Z:/share",
  ]);
  expect([...coworkNetworkDriveFolderPaths([local, net])]).toEqual(["Z:/share"]);
  expect(coworkFolderPermissionPaths([local, net]).sort()).toEqual(
    ["/Users/a/Projects", "Z:/share", "\\\\server\\share"].sort(),
  );
  expect(coworkNetworkDriveFolderPaths([local]).size).toBe(0);
});

it("stores network-drive kind in host-loop and denies sandboxed non-local", () => {
  const host = session({ hostLoopMode: true });
  const netKind = {
    kind: "network-drive" as const,
    display: "Z:/share/proj",
    unc: "\\\\server\\share\\proj",
  };
  expect(mountCoworkSessionFolderFromPathKind(host, netKind)).toEqual({
    ok: true,
    folderPath: "Z:/share/proj",
    networkDrive: true,
  });
  expect(host.resolvedFolders).toEqual([
    {
      kind: "network-drive",
      display: "Z:/share/proj",
      unc: "\\\\server\\share\\proj",
    },
  ]);
  expect([...coworkNetworkDriveFolderPaths(host.resolvedFolders)]).toEqual([
    "Z:/share/proj",
  ]);

  const sandboxed = session({ hostLoopMode: false });
  expect(mountCoworkSessionFolderFromPathKind(sandboxed, netKind)).toEqual({
    ok: false,
    error: COWORK_NETWORK_DRIVE_SANDBOX_DENY,
  });
  expect(sandboxed.resolvedFolders).toEqual([]);
});

it("AAA only local + network-drive are resume-resolvable", () => {
  expect(
    isCoworkResumeResolvablePathKind({
      kind: "local",
      display: "/a",
      canonical: "/a",
    }),
  ).toBe(true);
  expect(
    isCoworkResumeResolvablePathKind({
      kind: "network-drive",
      display: "Z:/s",
      unc: "//s",
    }),
  ).toBe(true);
  expect(
    isCoworkResumeResolvablePathKind({ kind: "literal-unc", display: "//s/x" }),
  ).toBe(false);
  expect(
    isCoworkResumeResolvablePathKind({
      kind: "junction-to-unc",
      display: "/j",
    }),
  ).toBe(false);
  expect(isCoworkResumeResolvablePathKind(null)).toBe(false);
});

it("resolveAndFilter: new session uses zni (keep non-null Mh); resume AAA + missing", async () => {
  const classify = async (p: string): Promise<CoworkPathKind | null> => {
    if (p === "/gone") return null;
    if (p === "//unc") return { kind: "literal-unc", display: p };
    if (p === "/ok") return { kind: "local", display: p, canonical: p };
    if (p === "Z:/net")
      return { kind: "network-drive", display: p, unc: "//server/share" };
    return null;
  };

  const fresh = await resolveAndFilterCoworkSessionFolders(
    ["/ok", "/gone", "//unc", "Z:/net"],
    { resumeMode: false, classify },
  );
  // zni keeps all non-null Mh kinds (including literal-unc)
  expect(fresh.missing).toEqual([]);
  expect(fresh.resolved.map((f) => f.kind)).toEqual([
    "local",
    "literal-unc",
    "network-drive",
  ]);

  const resume = await resolveAndFilterCoworkSessionFolders(
    ["/ok", "/gone", "//unc", "Z:/net"],
    { resumeMode: true, classify },
  );
  expect(resume.resolved.map((f) => f.display)).toEqual(["/ok", "Z:/net"]);
  // missing = inputs not in Lc list (gone + literal-unc)
  expect(resume.missing).toEqual(["/gone", "//unc"]);
});

it("maps Mh pathKind to resolved folder entries", () => {
  expect(
    coworkPathKindToResolvedFolder({
      kind: "local",
      display: "/d",
      canonical: "/real/d",
    }),
  ).toEqual({ kind: "local", display: "/d", canonical: "/real/d" });
  expect(
    coworkPathKindToResolvedFolder({
      kind: "network-drive",
      display: "Z:/x",
      unc: "\\\\s\\x",
    }),
  ).toEqual({ kind: "network-drive", display: "Z:/x", unc: "\\\\s\\x" });
  expect(
    addCoworkSessionResolvedFolder(session({ hostLoopMode: true }), {
      kind: "junction-to-unc",
      display: "/junc",
    }),
  ).toMatchObject({ ok: true, networkDrive: true });
});

it("eBe filterCoworkDraftSessionFolders: unrestricted / allowlist / drop callback", () => {
  expect(
    filterCoworkDraftSessionFolders(["/a", "/b"], null),
  ).toEqual(["/a", "/b"]);
  expect(
    filterCoworkDraftSessionFolders(["/a", "/b"], undefined),
  ).toEqual(["/a", "/b"]);

  const dropped: string[] = [];
  expect(
    filterCoworkDraftSessionFolders(
      ["/allowed/sub", "/other", "/allowed"],
      ["/allowed"],
      (info) => dropped.push(info.folderPath),
    ),
  ).toEqual(["/allowed/sub", "/allowed"]);
  expect(dropped).toEqual(["/other"]);

  // empty allowlist → drop all (Th returns [] is truthy allowlist of none)
  expect(
    filterCoworkDraftSessionFolders(["/a"], []),
  ).toEqual([]);
});
