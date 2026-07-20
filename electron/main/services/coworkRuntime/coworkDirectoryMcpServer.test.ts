import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  COWORK_ALLOW_FILE_DELETE_TOOL,
  COWORK_DIRECTORY_MCP_NAME,
  COWORK_FOLDER_ACCESS_DISABLED_BY_ADMIN,
  COWORK_MARK_TASK_COMPLETE_RESULT,
  COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT,
  COWORK_MARK_TASK_COMPLETE_TOOL,
  COWORK_PRESENT_FILES_TOOL,
  COWORK_REQUEST_DIRECTORY_HOST_HOME_HINT,
  COWORK_REQUEST_DIRECTORY_INTERNAL_PREPROMPT_MESSAGE,
  COWORK_REQUEST_DIRECTORY_MCP_TOOL,
  COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE,
  COWORK_REQUEST_DIRECTORY_TOOL,
  COWORK_UNC_PATHS_NOT_ALLOWED,
  appendCoworkMarkTaskCompleteSystemPrompt,
  classifyCoworkAdminWorkspaceFolders,
  classifyCoworkMountStructuralDenial,
  classifyCoworkPathKind,
  createCoworkDirectoryMcpServerConfig,
  coworkAdminWorkspaceRootsDenyMessage,
  coworkNetworkDriveProvidedPathDenyMessage,
  coworkPathHasNoSymlinkComponents,
  coworkPathNotAccessibleMessage,
  coworkRequestDirectoryPathRequiredMessage,
  denyCoworkPathKindForMount,
  evaluateCoworkAdminWorkspacePathKind,
  isCoworkLiteralUncPath,
  isCoworkNormalizedPathWithinRoot,
  isCoworkPathWithinNormalizedRoots,
  isCoworkUncLikePath,
  isCoworkWslUncPath,
  deniedCoworkMountRoot,
  expandCoworkDirectoryPath,
  getCoworkMountInfoFromPath,
  isCoworkCanonicalPathUnderAdminWorkspaceRoots,
  isCoworkInternalStoragePath,
  isCoworkPathUnderAdminWorkspaceRoots,
  isCoworkScratchpadVmPath,
  preFilterCoworkRequestDirectoryPermission,
  prepareCoworkRequestDirectoryPermissionInput,
  requiresCoworkRequestDirectoryPath,
  resolveCoworkDirectoryMountCandidate,
  resolveCoworkPresentableHostPath,
  validateCoworkDirectoryMountPath,
  withCoworkDirectoryMcpServer,
  type CoworkPathSafetyFs,
} from "./coworkDirectoryMcpServer";

type RegisteredTool = {
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<{
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

const home = "/Users/cowork";

/** Test Mh/Uc: no UNC symlinks; realpath identity (local kind). */
function localPathSafetyFs(
  overrides: Partial<CoworkPathSafetyFs> = {},
): Partial<CoworkPathSafetyFs> {
  return {
    lstat: async () => ({ isSymbolicLink: () => false }),
    readlink: async () => {
      throw new Error("unexpected readlink");
    },
    realpath: async (target) => path.resolve(target),
    ...overrides,
  };
}

it("expands ~ and .host-home aliases like official eJA", () => {
  expect(expandCoworkDirectoryPath("~", home)).toBe(home);
  expect(expandCoworkDirectoryPath("~/Documents", home)).toBe(
    path.join(home, "Documents"),
  );
  expect(
    expandCoworkDirectoryPath("/sessions/vm-1/mnt/.host-home", home),
  ).toBe(home);
  expect(
    expandCoworkDirectoryPath("/sessions/vm-1/mnt/.host-home/Downloads", home),
  ).toBe(path.join(home, "Downloads"));
  expect(expandCoworkDirectoryPath("/tmp/project", home)).toBe("/tmp/project");
});

it("denies protected home segments and files like official AJA", () => {
  expect(deniedCoworkMountRoot(path.join(home, ".ssh"), home)).toBe(
    path.join(home, ".ssh"),
  );
  expect(deniedCoworkMountRoot(path.join(home, ".ssh", "id_rsa"), home)).toBe(
    path.join(home, ".ssh"),
  );
  expect(deniedCoworkMountRoot(path.join(home, ".zshrc"), home)).toBe(
    path.join(home, ".zshrc"),
  );
  // Mounting home (or any ancestor of a protected root) is denied by overlap.
  expect(deniedCoworkMountRoot(home, home)).toBe(path.join(home, ".ssh"));
  expect(deniedCoworkMountRoot("/tmp/project", home)).toBeNull();
});

it("detects cowork internal session storage like official XPA", () => {
  const storage = "/tmp/local-agent-mode-sessions/acct/org/session-1";
  expect(isCoworkInternalStoragePath(storage, storage)).toBe(true);
  expect(
    isCoworkInternalStoragePath(path.join(storage, "outputs"), storage),
  ).toBe(true);
  expect(isCoworkInternalStoragePath("/tmp/other", storage)).toBe(false);
  expect(isCoworkInternalStoragePath(storage, null)).toBe(false);
});

it("classifies structural home/root denials like official TKi", () => {
  expect(classifyCoworkMountStructuralDenial(home, home)).toContain(
    "home directory itself",
  );
  expect(classifyCoworkMountStructuralDenial("/", home)).toContain(
    "filesystem root",
  );
  expect(
    classifyCoworkMountStructuralDenial(path.join(home, "Projects"), home),
  ).toBeNull();
});

it("validates absolute/existing/protected paths like official P4 subset", async () => {
  const okPath = path.join(home, "Projects", "app");
  expect(
    await validateCoworkDirectoryMountPath(okPath, {
      home,
      requireExistingDirectory: true,
      sessionStorageDir: "/tmp/storage",
      stat: { exists: true, isDirectory: true },
    }),
  ).toEqual({ ok: true, path: okPath });

  expect(
    await validateCoworkDirectoryMountPath("relative/path", { home }),
  ).toEqual({
    ok: false,
    error: coworkPathNotAccessibleMessage("relative/path", "darwin"),
  });
  expect(
    await validateCoworkDirectoryMountPath("folder", {
      home,
      platform: "win32",
    }),
  ).toEqual({
    ok: false,
    error: coworkPathNotAccessibleMessage("folder", "win32"),
  });

  expect(
    await validateCoworkDirectoryMountPath(path.join(home, ".aws"), {
      home,
      requireExistingDirectory: false,
    }),
  ).toMatchObject({ ok: false });

  expect(
    await validateCoworkDirectoryMountPath(okPath, {
      home,
      requireExistingDirectory: true,
      stat: { exists: false, isDirectory: false },
    }),
  ).toMatchObject({ ok: false });

  expect(
    await validateCoworkDirectoryMountPath(okPath, {
      home,
      requireExistingDirectory: true,
      stat: { exists: true, isDirectory: false },
    }),
  ).toMatchObject({
    ok: false,
    error: expect.stringContaining("not a directory"),
  });
});

it("tool + prepare reject UNC/relative before path.resolve wash", async () => {
  // Official P4: Hs/kKi on raw provided path; POSIX resolve must not wash // or relative.
  expect(resolveCoworkDirectoryMountCandidate("//server/share", { home })).toEqual({
    ok: false,
    error: COWORK_UNC_PATHS_NOT_ALLOWED,
  });
  expect(
    resolveCoworkDirectoryMountCandidate("\\\\server\\share", { home }),
  ).toEqual({ ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED });
  expect(resolveCoworkDirectoryMountCandidate("docs", { home })).toEqual({
    ok: false,
    error: coworkPathNotAccessibleMessage("docs"),
  });
  expect(
    resolveCoworkDirectoryMountCandidate(path.join(home, "Projects"), { home }),
  ).toEqual({ ok: true, path: path.resolve(home, "Projects") });

  const mountFolder = vi.fn(async (kind: { display: string; kind: string }) => ({
    ok: true as const,
    displayPath: kind.display,
    mode: "host-loop" as const,
    networkDrive: kind.kind !== "local",
  }));
  const server = createCoworkDirectoryMcpServerConfig({
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s-unc",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-unc",
  });
  const tool = registeredTools(server)[COWORK_REQUEST_DIRECTORY_TOOL];

  const uncSlash = await tool.handler({ path: "//server/share" });
  expect(uncSlash.isError).toBe(true);
  expect(String(uncSlash.content[0]?.text)).toBe(COWORK_UNC_PATHS_NOT_ALLOWED);

  const uncBack = await tool.handler({ path: "\\\\server\\share" });
  expect(uncBack.isError).toBe(true);
  expect(String(uncBack.content[0]?.text)).toBe(COWORK_UNC_PATHS_NOT_ALLOWED);

  const relative = await tool.handler({ path: "docs" });
  expect(relative.isError).toBe(true);
  expect(String(relative.content[0]?.text)).toBe(
    coworkPathNotAccessibleMessage("docs"),
  );
  expect(mountFolder).not.toHaveBeenCalled();

  // prepare: UNC/relative withhold _hostPath (official P4.ok gate).
  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: "//server/share" },
      { home, pathSafetyFs: localPathSafetyFs() },
    ),
  ).toEqual({ path: "//server/share" });
  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: "docs" },
      { home, pathSafetyFs: localPathSafetyFs() },
    ),
  ).toEqual({ path: "docs" });
});

it("classifies official Mh path kinds (literal-unc / network-drive / local / junction)", async () => {
  const fsLocal = localPathSafetyFs();
  await expect(
    classifyCoworkPathKind("//server/share", { fs: fsLocal }),
  ).resolves.toEqual({ kind: "literal-unc", display: "//server/share" });
  await expect(
    classifyCoworkPathKind("docs", { fs: fsLocal }),
  ).resolves.toBeNull();
  await expect(
    classifyCoworkPathKind(path.join(home, "Projects"), { fs: fsLocal }),
  ).resolves.toEqual({
    kind: "local",
    display: path.normalize(path.join(home, "Projects")),
    canonical: path.resolve(home, "Projects"),
  });

  // realpath → UNC ⇒ network-drive (providedPath deny message).
  const netFs = localPathSafetyFs({
    realpath: async () => "\\\\fileserver\\share",
  });
  await expect(
    classifyCoworkPathKind(path.join(home, "NetShare"), { fs: netFs }),
  ).resolves.toEqual({
    kind: "network-drive",
    display: path.normalize(path.join(home, "NetShare")),
    unc: "\\\\fileserver\\share",
  });
  expect(
    denyCoworkPathKindForMount(
      {
        kind: "network-drive",
        display: path.join(home, "NetShare"),
        unc: "\\\\fileserver\\share",
      },
      true,
    ),
  ).toBe(
    coworkNetworkDriveProvidedPathDenyMessage(path.join(home, "NetShare")),
  );
  // Picker allows network-drive.
  expect(
    denyCoworkPathKindForMount(
      {
        kind: "network-drive",
        display: path.join(home, "NetShare"),
        unc: "\\\\fileserver\\share",
      },
      false,
    ),
  ).toBeNull();

  // Uc symlink-to-UNC ⇒ junction-to-unc.
  const junctionFs = localPathSafetyFs({
    lstat: async () => ({ isSymbolicLink: () => true }),
    readlink: async () => "\\\\server\\share\\target",
  });
  await expect(
    classifyCoworkPathKind(path.join(home, "Link"), { fs: junctionFs }),
  ).resolves.toEqual({
    kind: "junction-to-unc",
    display: path.normalize(path.join(home, "Link")),
  });
  expect(
    denyCoworkPathKindForMount(
      { kind: "junction-to-unc", display: path.join(home, "Link") },
      false,
    ),
  ).toBe(COWORK_UNC_PATHS_NOT_ALLOWED);

  // Tool providedPath network-drive message via Mh inject.
  const mountFolder = vi.fn();
  const server = createCoworkDirectoryMcpServerConfig({
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: netFs,
    sessionId: "s-mh",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-mh",
  });
  const tool = registeredTools(server)[COWORK_REQUEST_DIRECTORY_TOOL];
  const denied = await tool.handler({ path: path.join(home, "NetShare") });
  expect(denied.isError).toBe(true);
  expect(String(denied.content[0]?.text)).toBe(
    coworkNetworkDriveProvidedPathDenyMessage(
      path.normalize(path.join(home, "NetShare")),
    ),
  );
  expect(mountFolder).not.toHaveBeenCalled();
});

it("classifies official kKi messages and literal UNC (Hs/QRA) for P4", async () => {
  expect(coworkPathNotAccessibleMessage("/abs/missing", "darwin")).toBe(
    'Path "/abs/missing" doesn\'t exist or isn\'t accessible.',
  );
  expect(coworkPathNotAccessibleMessage("rel", "darwin")).toBe(
    "Relative paths are not allowed. Use an absolute path.",
  );
  expect(coworkPathNotAccessibleMessage("rel", "win32")).toBe(
    "Drive-relative paths are not allowed. Use an absolute path like H:\\folder.",
  );

  expect(isCoworkUncLikePath("\\\\server\\share")).toBe(true);
  expect(isCoworkUncLikePath("//server/share")).toBe(true);
  expect(isCoworkWslUncPath("\\\\wsl$\\Ubuntu\\home")).toBe(true);
  expect(isCoworkWslUncPath("\\\\wsl.localhost\\Ubuntu\\home")).toBe(true);
  expect(isCoworkLiteralUncPath("\\\\server\\share")).toBe(true);
  expect(isCoworkLiteralUncPath("\\\\wsl$\\Ubuntu\\home")).toBe(false);

  expect(
    await validateCoworkDirectoryMountPath("\\\\server\\share\\proj", {
      home,
      requireExistingDirectory: false,
    }),
  ).toEqual({ ok: false, error: COWORK_UNC_PATHS_NOT_ALLOWED });

  // Official providedPath network-drive message when inject classified.
  expect(
    await validateCoworkDirectoryMountPath(path.join(home, "Projects", "net"), {
      home,
      networkDrive: true,
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: coworkNetworkDriveProvidedPathDenyMessage(
      path.join(home, "Projects", "net"),
    ),
  });
});

it("classifies official Th/tG admin workspace folder policy", () => {
  expect(classifyCoworkAdminWorkspaceFolders(undefined)).toEqual({
    kind: "unrestricted",
  });
  expect(classifyCoworkAdminWorkspaceFolders(null)).toEqual({
    kind: "unrestricted",
  });
  expect(classifyCoworkAdminWorkspaceFolders([])).toEqual({ kind: "disabled" });
  expect(
    classifyCoworkAdminWorkspaceFolders(["/Users/cowork/Projects", "/data"]),
  ).toEqual({
    kind: "allowlist",
    roots: [path.resolve("/Users/cowork/Projects"), path.resolve("/data")],
  });

  expect(
    isCoworkPathUnderAdminWorkspaceRoots(path.join(home, "Projects", "app"), [
      path.join(home, "Projects"),
    ]),
  ).toBe(true);
  expect(
    isCoworkPathUnderAdminWorkspaceRoots(path.join(home, "Downloads"), [
      path.join(home, "Projects"),
    ]),
  ).toBe(false);

  expect(
    coworkAdminWorkspaceRootsDenyMessage("/tmp/x", ["/a", "/b"]),
  ).toContain("not within the allowed workspace roots");
  expect(
    coworkAdminWorkspaceRootsDenyMessage("/tmp/x", ["/a", "/b"]),
  ).toContain("/a, /b");
});

it("denies P4 mount when admin workspace folders disabled or outside roots", async () => {
  const okPath = path.join(home, "Projects", "app");
  expect(
    await validateCoworkDirectoryMountPath(okPath, {
      allowedWorkspaceFolders: [],
      home,
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: COWORK_FOLDER_ACCESS_DISABLED_BY_ADMIN,
  });

  // Synthetic home paths: use path.resolve membership (adminRootsUseRealpath false).
  expect(
    await validateCoworkDirectoryMountPath(okPath, {
      adminRootsUseRealpath: false,
      allowedWorkspaceFolders: [path.join(home, "Projects")],
      home,
      requireExistingDirectory: false,
    }),
  ).toEqual({ ok: true, path: okPath });

  const outside = path.join(home, "Downloads", "other");
  const roots = [path.join(home, "Projects")];
  expect(
    await validateCoworkDirectoryMountPath(outside, {
      adminRootsUseRealpath: false,
      allowedWorkspaceFolders: roots,
      home,
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: coworkAdminWorkspaceRootsDenyMessage(outside, [
      path.resolve(roots[0]!),
    ]),
  });
});

it("uses official async GHA realpath membership for admin roots", async () => {
  const root = path.join(home, "Projects");
  const inside = path.join(home, "Projects", "app");
  const outside = path.join(home, "Downloads", "other");
  const missingRoot = path.join(home, "MissingRoot");
  const realpathMap = new Map<string, string>([
    [path.resolve(root), path.resolve(root)],
    [path.resolve(inside), path.resolve(inside)],
    [path.resolve(outside), path.resolve(outside)],
  ]);
  const realpath = async (target: string) => {
    const key = path.resolve(target);
    const hit = realpathMap.get(key);
    if (!hit) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return hit;
  };

  expect(
    await isCoworkCanonicalPathUnderAdminWorkspaceRoots(inside, [root], {
      realpath,
    }),
  ).toBe(true);
  expect(
    await isCoworkCanonicalPathUnderAdminWorkspaceRoots(outside, [root], {
      realpath,
    }),
  ).toBe(false);
  // Missing root realpath → skip (official catch continue), not allow.
  expect(
    await isCoworkCanonicalPathUnderAdminWorkspaceRoots(inside, [missingRoot], {
      realpath,
    }),
  ).toBe(false);

  // Symlink-style: candidate realpath equals root realpath via different display.
  const aliasRoot = path.join(home, "AliasProjects");
  realpathMap.set(path.resolve(aliasRoot), path.resolve(root));
  expect(
    await isCoworkCanonicalPathUnderAdminWorkspaceRoots(
      path.resolve(inside),
      [aliasRoot],
      { realpath },
    ),
  ).toBe(true);

  expect(
    await validateCoworkDirectoryMountPath(inside, {
      allowedWorkspaceFolders: [root],
      home,
      pathSafetyFs: { realpath },
      requireExistingDirectory: false,
    }),
  ).toEqual({ ok: true, path: inside });
  expect(
    await validateCoworkDirectoryMountPath(outside, {
      allowedWorkspaceFolders: [root],
      home,
      pathSafetyFs: { realpath },
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: coworkAdminWorkspaceRootsDenyMessage(outside, [path.resolve(root)]),
  });
});

it("implements official t4/ol normalized membership and zrA no-symlink", async () => {
  const root = path.join(home, "Projects");
  const inside = path.join(home, "Projects", "app");
  // t4: equal allowed; child under root; sibling denied; `..foo` name allowed
  // (official: not `..` and not `..${sep}` — looser than GHA startsWith("..")).
  expect(isCoworkNormalizedPathWithinRoot(root, root)).toBe(true);
  expect(isCoworkNormalizedPathWithinRoot(inside, root)).toBe(true);
  expect(
    isCoworkNormalizedPathWithinRoot(path.join(home, "Downloads"), root),
  ).toBe(false);
  expect(
    isCoworkNormalizedPathWithinRoot(path.join(home, "Projects-other"), root),
  ).toBe(false);
  expect(
    isCoworkNormalizedPathWithinRoot(path.join(root, "..foo"), root),
  ).toBe(true);
  expect(
    isCoworkPathWithinNormalizedRoots(inside, [root, path.join(home, "Other")]),
  ).toBe(true);
  expect(
    isCoworkPathWithinNormalizedRoots(path.join(home, "Downloads"), [root]),
  ).toBe(false);

  const noLinkFs = localPathSafetyFs();
  expect(
    await coworkPathHasNoSymlinkComponents(inside, { fs: noLinkFs }),
  ).toBe(true);

  const linkFs = localPathSafetyFs({
    lstat: async (target) => {
      if (path.resolve(target) === path.resolve(path.join(home, "Projects"))) {
        return { isSymbolicLink: () => true };
      }
      return { isSymbolicLink: () => false };
    },
  });
  expect(await coworkPathHasNoSymlinkComponents(inside, { fs: linkFs })).toBe(
    false,
  );
  // Missing component → false (official catch).
  const missingFs = localPathSafetyFs({
    lstat: async () => null,
  });
  expect(
    await coworkPathHasNoSymlinkComponents(inside, { fs: missingFs }),
  ).toBe(false);
});

it("evaluateCoworkAdminWorkspacePathKind matches official tG branches", async () => {
  const root = path.resolve(path.join(home, "Projects"));
  const inside = path.resolve(path.join(home, "Projects", "app"));
  const outside = path.resolve(path.join(home, "Downloads", "other"));
  const realpath = async (target: string) => path.resolve(target);
  const noLink = localPathSafetyFs({ realpath });

  // local → GHA
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      { kind: "local", display: inside, canonical: inside },
      [root],
      { pathSafetyFs: noLink },
    ),
  ).toEqual({ allowed: true });
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      { kind: "local", display: outside, canonical: outside },
      [root],
      { pathSafetyFs: noLink },
    ),
  ).toMatchObject({ allowed: false, folderPath: outside });

  // junction-to-unc → always deny under allowlist
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      { kind: "junction-to-unc", display: inside },
      [root],
      { pathSafetyFs: noLink },
    ),
  ).toEqual({
    allowed: false,
    folderPath: inside,
    allowedRoots: [root],
  });

  // network-drive + zrA ok + ol membership
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      {
        kind: "network-drive",
        display: inside,
        unc: "\\\\server\\share\\app",
      },
      [root],
      { pathSafetyFs: noLink },
    ),
  ).toEqual({ allowed: true });

  // network-drive outside roots → deny even if zrA ok
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      {
        kind: "network-drive",
        display: outside,
        unc: "\\\\server\\share\\other",
      },
      [root],
      { pathSafetyFs: noLink },
    ),
  ).toMatchObject({ allowed: false, folderPath: outside });

  // network-drive with symlink component → deny without ol
  const withLink = localPathSafetyFs({
    realpath,
    lstat: async () => ({ isSymbolicLink: () => true }),
  });
  expect(
    await evaluateCoworkAdminWorkspacePathKind(
      {
        kind: "network-drive",
        display: inside,
        unc: "\\\\server\\share\\app",
      },
      [root],
      { pathSafetyFs: withLink },
    ),
  ).toMatchObject({ allowed: false });
});

it("validate + tool use full tG pathKind (network-drive zrA/ol)", async () => {
  const root = path.join(home, "Projects");
  const inside = path.join(home, "Projects", "netshare");
  const outside = path.join(home, "Downloads", "netshare");
  const noLink = localPathSafetyFs();

  // Picker network-drive under admin root, no symlink → allow via tG ol.
  expect(
    await validateCoworkDirectoryMountPath(inside, {
      allowedWorkspaceFolders: [root],
      home,
      pathKind: {
        kind: "network-drive",
        display: inside,
        unc: "\\\\fileserver\\proj\\netshare",
      },
      pathSafetyFs: noLink,
      providedPath: false,
      requireExistingDirectory: false,
    }),
  ).toEqual({ ok: true, path: inside });

  // network-drive outside allowlist → display-path deny message
  expect(
    await validateCoworkDirectoryMountPath(outside, {
      allowedWorkspaceFolders: [root],
      home,
      pathKind: {
        kind: "network-drive",
        display: outside,
        unc: "\\\\fileserver\\other",
      },
      pathSafetyFs: noLink,
      providedPath: false,
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: coworkAdminWorkspaceRootsDenyMessage(outside, [path.resolve(root)]),
  });

  // junction under allowlist pathKind → deny (tG always)
  expect(
    await validateCoworkDirectoryMountPath(inside, {
      allowedWorkspaceFolders: [root],
      home,
      pathKind: { kind: "junction-to-unc", display: inside },
      pathSafetyFs: noLink,
      providedPath: false,
      requireExistingDirectory: false,
    }),
  ).toEqual({
    ok: false,
    error: coworkAdminWorkspaceRootsDenyMessage(inside, [path.resolve(root)]),
  });

  // Tool picker path: network-drive inside admin root mounts OK.
  const mountFolder = vi.fn(async (kind: {
    display: string;
    kind: string;
    unc?: string;
  }) => ({
    ok: true as const,
    displayPath: kind.display,
    mode: "host-loop" as const,
    networkDrive: kind.kind !== "local",
  }));
  const server = createCoworkDirectoryMcpServerConfig({
    getAllowedWorkspaceFolders: () => [root],
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs({
      realpath: async (target) => {
        // realpath → UNC classifies as network-drive
        if (path.resolve(target) === path.resolve(inside)) {
          return "\\\\fileserver\\proj\\netshare";
        }
        return path.resolve(target);
      },
    }),
    pickDirectory: async () => ({ canceled: false, path: inside }),
    sessionId: "s-tg-net",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-tg",
  });
  const tools = registeredTools(server);
  const result = await tools[COWORK_REQUEST_DIRECTORY_TOOL]!.handler({});
  expect(result.isError).toBeFalsy();
  expect(result.content[0]?.text).toContain("Folder connected");
  expect(result.content[0]?.text).toContain("network drive");
  expect(mountFolder).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "network-drive",
      display: inside,
      unc: "\\\\fileserver\\proj\\netshare",
    }),
  );

  // Tool: network-drive outside roots denied by tG.
  mountFolder.mockClear();
  const deniedServer = createCoworkDirectoryMcpServerConfig({
    getAllowedWorkspaceFolders: () => [root],
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs({
      realpath: async (target) => {
        if (path.resolve(target) === path.resolve(outside)) {
          return "\\\\fileserver\\other";
        }
        return path.resolve(target);
      },
    }),
    pickDirectory: async () => ({ canceled: false, path: outside }),
    sessionId: "s-tg-out",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-tg",
  });
  const denied = await registeredTools(deniedServer)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ]!.handler({});
  expect(denied.isError).toBe(true);
  expect(denied.content[0]?.text).toContain(
    "not within the allowed workspace roots",
  );
  expect(mountFolder).not.toHaveBeenCalled();
});

it("request_cowork_directory uses getAllowedWorkspaceFolders inject", async () => {
  const mountFolder = vi.fn(async (kind: { display: string; kind: string }) => ({
    ok: true as const,
    displayPath: kind.kind === "local" && "canonical" in kind
      ? (kind as { canonical: string }).canonical
      : kind.display,
    mode: "host-loop" as const,
    networkDrive: kind.kind !== "local",
  }));
  const allowed = path.join(home, "Projects");
  const server = createCoworkDirectoryMcpServerConfig({
    getAllowedWorkspaceFolders: () => [allowed],
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s1",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-1",
  });
  const tool = registeredTools(server)[COWORK_REQUEST_DIRECTORY_TOOL];

  const denied = await tool.handler({
    path: path.join(home, "Downloads"),
  });
  expect(denied.isError).toBe(true);
  expect(String(denied.content[0]?.text)).toContain(
    "not within the allowed workspace roots",
  );
  expect(mountFolder).not.toHaveBeenCalled();

  const ok = await tool.handler({
    path: path.join(allowed, "app"),
  });
  expect(ok.isError).toBeUndefined();
  expect(mountFolder).toHaveBeenCalledOnce();
  expect(mountFolder).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "local",
      display: path.join(allowed, "app"),
    }),
  );

  const disabled = createCoworkDirectoryMcpServerConfig({
    getAllowedWorkspaceFolders: () => [],
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s2",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-2",
  });
  const disabledResult = await registeredTools(disabled)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ].handler({ path: path.join(allowed, "app") });
  expect(disabledResult.isError).toBe(true);
  expect(String(disabledResult.content[0]?.text)).toBe(
    COWORK_FOLDER_ACCESS_DISABLED_BY_ADMIN,
  );
});

it("requires path when picker is unavailable (remote residual)", async () => {
  const server = createCoworkDirectoryMcpServerConfig({
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const tool = registeredTools(server)[COWORK_REQUEST_DIRECTORY_TOOL];
  const result = await tool.handler({});
  expect(result.isError).toBe(true);
  expect(String(result.content[0]?.text)).toContain("path");
});

it("returns cancel text when folder picker is cancelled", async () => {
  const server = createCoworkDirectoryMcpServerConfig({
    pickDirectory: async () => ({ canceled: true }),
    sessionId: "s1",
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ].handler({});
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toBe(
    "Directory selection was cancelled by the user.",
  );
});

it("returns host-loop Folder connected success text", async () => {
  const mountFolder = vi.fn(async (kind: { display: string }) => ({
    ok: true as const,
    displayPath: kind.display,
    mode: "host-loop" as const,
    bashMountName: "project",
  }));
  const server = createCoworkDirectoryMcpServerConfig({
    getHomeDir: () => home,
    isHostLoopMode: true,
    mountFolder,
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s1",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ].handler({ path: path.join(home, "Projects", "app") });
  expect(mountFolder).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "local",
      display: path.join(home, "Projects", "app"),
    }),
  );
  expect(result.isError).toBeUndefined();
  const text = String(result.content[0]?.text);
  expect(text).toContain("Folder connected:");
  expect(text).toContain("Read/Write/Edit/Grep/Glob");
  expect(text).toContain("/sessions/proc-1/mnt/project");
  expect(text).toContain("mcp__workspace__bash ONLY");
});

it("returns mount error when mountFolder fails", async () => {
  const server = createCoworkDirectoryMcpServerConfig({
    getHomeDir: () => home,
    mountFolder: async () => ({ ok: false, error: "disk full" }),
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s1",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ].handler({ path: path.join(home, "Projects", "app") });
  expect(result.isError).toBe(true);
  expect(String(result.content[0]?.text)).toContain("disk full");
});

it("denies protected paths before mount", async () => {
  const mountFolder = vi.fn();
  const server = createCoworkDirectoryMcpServerConfig({
    getHomeDir: () => home,
    mountFolder,
    pathSafetyFs: localPathSafetyFs(),
    sessionId: "s1",
    statPath: async () => ({ exists: true, isDirectory: true }),
    vmProcessName: "proc-1",
  });
  const result = await registeredTools(server)[
    COWORK_REQUEST_DIRECTORY_TOOL
  ].handler({ path: path.join(home, ".ssh") });
  expect(result.isError).toBe(true);
  expect(String(result.content[0]?.text)).toContain("protected host location");
  expect(mountFolder).not.toHaveBeenCalled();
});

it("merges cowork directory MCP server when options provided", () => {
  const merged = withCoworkDirectoryMcpServer(
    { skills: { name: "skills" } },
    {
      sessionId: "s1",
      vmProcessName: "p1",
    },
  );
  expect(merged.skills).toEqual({ name: "skills" });
  expect(merged[COWORK_DIRECTORY_MCP_NAME]).toBeDefined();
  const tools = registeredTools(merged[COWORK_DIRECTORY_MCP_NAME]);
  expect(tools[COWORK_REQUEST_DIRECTORY_TOOL]?.handler).toBeTypeOf("function");
  expect(tools[COWORK_ALLOW_FILE_DELETE_TOOL]?.handler).toBeTypeOf("function");
  expect(tools[COWORK_PRESENT_FILES_TOOL]?.handler).toBeTypeOf("function");
  expect(tools[COWORK_MARK_TASK_COMPLETE_TOOL]?.handler).toBeTypeOf("function");

  const skipped = withCoworkDirectoryMcpServer({ a: 1 }, null);
  expect(skipped).toEqual({ a: 1 });
  expect(skipped[COWORK_DIRECTORY_MCP_NAME]).toBeUndefined();
});

it("pre-filters request_cowork_directory for protected and internal paths", () => {
  const storage = "/tmp/local-agent-mode-sessions/acct/org/s1";
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: path.join(home, ".ssh") },
      { home },
    ),
  ).toMatchObject({
    behavior: "deny",
    message: expect.stringContaining("protected host location"),
  });
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: path.join(storage, "outputs") },
      { home, sessionStorageDir: storage },
    ),
  ).toEqual({
    behavior: "deny",
    message: COWORK_REQUEST_DIRECTORY_INTERNAL_PREPROMPT_MESSAGE,
  });
  // Missing path is not pre-denied for local cowork (picker path).
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      {},
      { home },
    ),
  ).toBeUndefined();
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: path.join(home, "Projects") },
      { home },
    ),
  ).toBeUndefined();
  expect(
    preFilterCoworkRequestDirectoryPermission("Read", { path: "/tmp" }, { home }),
  ).toBeUndefined();
});

it("pre-denies missing path for official agent/dispatch_child sessions", () => {
  expect(requiresCoworkRequestDirectoryPath("agent")).toBe(true);
  expect(requiresCoworkRequestDirectoryPath("dispatch_child")).toBe(true);
  expect(requiresCoworkRequestDirectoryPath(undefined)).toBe(false);
  expect(requiresCoworkRequestDirectoryPath("cowork")).toBe(false);
  expect(requiresCoworkRequestDirectoryPath("scheduled")).toBe(false);

  expect(coworkRequestDirectoryPathRequiredMessage()).toBe(
    COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE,
  );
  expect(
    coworkRequestDirectoryPathRequiredMessage({ mountSkeletonHome: true }),
  ).toBe(
    COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE +
      COWORK_REQUEST_DIRECTORY_HOST_HOME_HINT,
  );

  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      {},
      { home, sessionType: "agent" },
    ),
  ).toEqual({
    behavior: "deny",
    message: COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE,
  });
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: "   " },
      { home, sessionType: "dispatch_child", mountSkeletonHome: true },
    ),
  ).toEqual({
    behavior: "deny",
    message:
      COWORK_REQUEST_DIRECTORY_PATH_REQUIRED_MESSAGE +
      COWORK_REQUEST_DIRECTORY_HOST_HOME_HINT,
  });
  // With path present, headless gate does not fire (XPA/AJA still apply).
  expect(
    preFilterCoworkRequestDirectoryPermission(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: path.join(home, "Projects") },
      { home, sessionType: "agent" },
    ),
  ).toBeUndefined();
});

it("prepares request_directory input with host path for always-allow", async () => {
  const fsLocal = localPathSafetyFs();
  const prepared = await prepareCoworkRequestDirectoryPermissionInput(
    COWORK_REQUEST_DIRECTORY_MCP_TOOL,
    {
      path: path.join(home, "Projects", "app"),
      _hostPathForRequestDirectoryTool: "/stale",
    },
    { home, pathSafetyFs: fsLocal },
  );
  expect(prepared).toMatchObject({
    path: path.resolve(home, "Projects", "app"),
    _hostPathForRequestDirectoryTool: path.resolve(home, "Projects", "app"),
  });
  // Protected path still expands path but no host-path attachment after validate fail.
  const protectedPrep = await prepareCoworkRequestDirectoryPermissionInput(
    COWORK_REQUEST_DIRECTORY_MCP_TOOL,
    { path: path.join(home, ".ssh") },
    { home, pathSafetyFs: fsLocal },
  );
  expect(protectedPrep).toEqual({
    path: path.normalize(path.join(home, ".ssh")),
  });
  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      "Read",
      { path: "/x" },
      { home, pathSafetyFs: fsLocal },
    ),
  ).toEqual({ path: "/x" });
});

it("prepare only attaches host path when P4/Th/tG would allow (official canUseTool)", async () => {
  const inside = path.join(home, "Projects", "app");
  const outside = path.join(home, "Downloads", "other");
  const roots = [path.join(home, "Projects")];
  const fsLocal = localPathSafetyFs();

  // Official: P4.ok → attach _hostPath; P4 fail → expand path only, no hard deny.
  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: inside },
      { allowedWorkspaceFolders: roots, home, pathSafetyFs: fsLocal },
    ),
  ).toEqual({
    path: path.resolve(inside),
    _hostPathForRequestDirectoryTool: path.resolve(inside),
  });

  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: outside },
      { allowedWorkspaceFolders: roots, home, pathSafetyFs: fsLocal },
    ),
  ).toEqual({ path: path.normalize(outside) });

  expect(
    await prepareCoworkRequestDirectoryPermissionInput(
      COWORK_REQUEST_DIRECTORY_MCP_TOOL,
      { path: inside },
      { allowedWorkspaceFolders: [], home, pathSafetyFs: fsLocal },
    ),
  ).toEqual({ path: path.normalize(inside) });
});

it("detects scratchpad VM paths like official OeA", () => {
  expect(isCoworkScratchpadVmPath("/sessions/vm-1/tmp/out.md", "vm-1")).toBe(
    true,
  );
  expect(
    isCoworkScratchpadVmPath("/sessions/vm-1/mnt/project/a.md", "vm-1"),
  ).toBe(false);
  expect(isCoworkScratchpadVmPath("/Users/cowork/a.md", "vm-1")).toBe(false);
});

it("resolves mount info from host and VM paths like official tJA subset", () => {
  const project = path.join(home, "Projects", "app");
  const outputs = "/tmp/storage/outputs";
  expect(
    getCoworkMountInfoFromPath(path.join(project, "src/a.ts"), {
      getOutputsSubpath: () => outputs,
      getUserSelectedFolders: () => [project],
      vmProcessName: "vm-1",
    }),
  ).toMatchObject({ name: "app", hostPath: project });

  expect(
    getCoworkMountInfoFromPath(`/sessions/vm-1/mnt/app/src/a.ts`, {
      getUserSelectedFolders: () => [project],
      vmProcessName: "vm-1",
    }),
  ).toMatchObject({ name: "app", hostPath: project });

  expect(
    getCoworkMountInfoFromPath(path.join(outputs, "report.md"), {
      getOutputsSubpath: () => outputs,
      getUserSelectedFolders: () => [project],
      vmProcessName: "vm-1",
    }),
  ).toMatchObject({ name: "outputs", hostPath: outputs });

  expect(
    getCoworkMountInfoFromPath("/tmp/unmounted/file.txt", {
      getUserSelectedFolders: () => [project],
      vmProcessName: "vm-1",
    }),
  ).toBeNull();
});

it("allow_cowork_file_delete enables host-loop mount approval", async () => {
  const project = path.join(home, "Projects", "app");
  const approved: string[] = [];
  const server = createCoworkDirectoryMcpServerConfig({
    getUserSelectedFolders: () => [project],
    isHostLoopMode: true,
    sessionId: "s1",
    setFileDeleteApprovedForMount: (name) => approved.push(name),
    vmProcessName: "vm-1",
  });
  const ok = await registeredTools(server)[COWORK_ALLOW_FILE_DELETE_TOOL].handler({
    file_path: path.join(project, "delete-me.txt"),
  });
  expect(ok.isError).toBeUndefined();
  expect(ok.content[0]?.text).toBe(
    'File deletion is now enabled for the "app" folder.',
  );
  expect(approved).toEqual(["app"]);

  const miss = await registeredTools(server)[
    COWORK_ALLOW_FILE_DELETE_TOOL
  ].handler({ file_path: "/tmp/outside.txt" });
  expect(miss.isError).toBe(true);
  expect(String(miss.content[0]?.text)).toContain("Could not find mount");
});

it("present_files rejects inaccessible paths and accepts connected host files", async () => {
  const project = path.join(home, "Projects", "app");
  const outputs = "/tmp/storage/outputs";
  const server = createCoworkDirectoryMcpServerConfig({
    getHostOutputsDir: () => outputs,
    getUserSelectedFolders: () => [project],
    isHostLoopMode: true,
    sessionId: "s1",
    vmProcessName: "vm-1",
  });
  const present = registeredTools(server)[COWORK_PRESENT_FILES_TOOL];

  const bad = await present.handler({
    files: [{ file_path: "/tmp/secret/nope.txt" }],
  });
  expect(bad.isError).toBe(true);
  expect(String(bad.content[0]?.text)).toContain(
    "not accessible on the user's computer",
  );

  const good = await present.handler({
    files: [
      { file_path: path.join(project, "out.md") },
      { file_path: path.join(outputs, "chart.png") },
    ],
  });
  expect(good.isError).toBeUndefined();
  expect(good.content.map((c) => c.text)).toEqual([
    path.join(project, "out.md"),
    path.join(outputs, "chart.png"),
  ]);
});

it("resolveCoworkPresentableHostPath maps VM mounts via context", () => {
  const project = path.join(home, "Projects", "app");
  const storage = "/tmp/storage";
  const host = resolveCoworkPresentableHostPath(
    `/sessions/vm-1/mnt/app/readme.md`,
    {
      getHostOutputsDir: () => path.join(storage, "outputs"),
      getUserSelectedFolders: () => [project],
      getVMPathContext: () => ({
        mountNameMap: new Map([[project, "app"]]),
        sessionStorageDir: storage,
        userSelectedFolders: [project],
        vmProcessName: "vm-1",
      }),
      vmProcessName: "vm-1",
    },
  );
  expect(host).toBe(path.join(project, "readme.md"));
});

it("mark_task_complete calls onMarkTaskComplete and returns official text", async () => {
  let calls = 0;
  const server = createCoworkDirectoryMcpServerConfig({
    hasMarkTaskComplete: true,
    onMarkTaskComplete: () => {
      calls++;
    },
    sessionId: "s1",
    vmProcessName: "vm-1",
  });
  const result = await registeredTools(server)[
    COWORK_MARK_TASK_COMPLETE_TOOL
  ].handler({});
  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toBe(COWORK_MARK_TASK_COMPLETE_RESULT);
  expect(calls).toBe(1);

  // Official gate: hasMarkTaskComplete false → tool not registered.
  const gated = createCoworkDirectoryMcpServerConfig({
    hasMarkTaskComplete: false,
    sessionId: "s1",
    vmProcessName: "vm-1",
  });
  expect(registeredTools(gated)[COWORK_MARK_TASK_COMPLETE_TOOL]).toBeUndefined();
});

it("appends official mark_task_complete system-prompt guidance once when enabled", () => {
  const base = "You are Cowork.";
  const withGuide = appendCoworkMarkTaskCompleteSystemPrompt(base, true);
  expect(withGuide).toBe(base + COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT);
  expect(withGuide).toContain("Call the mark_task_complete tool as your final action");
  // Idempotent when already present.
  expect(appendCoworkMarkTaskCompleteSystemPrompt(withGuide, true)).toBe(
    withGuide,
  );
  // Disabled leaves base unchanged.
  expect(appendCoworkMarkTaskCompleteSystemPrompt(base, false)).toBe(base);
  // Empty base still returns guidance when enabled.
  expect(appendCoworkMarkTaskCompleteSystemPrompt(undefined, true)).toBe(
    COWORK_MARK_TASK_COMPLETE_SYSTEM_PROMPT,
  );
  expect(appendCoworkMarkTaskCompleteSystemPrompt(null, false)).toBeUndefined();
});
