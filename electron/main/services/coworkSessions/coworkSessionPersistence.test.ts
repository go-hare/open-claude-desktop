import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CoworkSessionPersistence } from "./coworkSessionPersistence";
import type {
  CoworkPersistedSessionMetadata,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "cowork-persistence-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runtimeState(
  overrides: Partial<CoworkSessionRuntimeState> = {},
): CoworkSessionRuntimeState {
  return {
    createdAt: 100,
    cwd: "/sessions/process-1",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isFirstTurn: true,
    lastActivityAt: 200,
    lifecycleState: "running",
    messageBuffer: [{ type: "user", uuid: "message-1" }],
    pendingNotifications: [],
    processName: "process-1",
    query: null,
    resolvedFolders: [
      { canonical: "/tmp/project", display: "/tmp/project", kind: "local" },
    ],
    sessionId: "local_session_1",
    vmProcessName: "process-1",
    ...overrides,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

it("writes ordinary and agent metadata under account and organization directories", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const ordinary = runtimeState();
  const agent = runtimeState({
    sessionId: "local_agent_1",
    sessionType: "agent",
  });

  persistence.saveSession(ordinary);
  persistence.saveSession(agent);
  await persistence.flushAll();

  expect(persistence.getSessionMetadataPath(ordinary)).toBe(
    path.join(
      userDataPath,
      "local-agent-mode-sessions",
      "account-1",
      "org-1",
      "local_session_1.json",
    ),
  );
  expect(persistence.getSessionMetadataPath(agent)).toBe(
    path.join(
      userDataPath,
      "local-agent-mode-sessions",
      "account-1",
      "org-1",
      "agent",
      "local_agent_1.json",
    ),
  );
  await expect(
    readFile(persistence.getSessionMetadataPath(agent), "utf8"),
  ).resolves.toContain("local_agent_1");
});

it("debounces a save for one second and excludes runtime-only data", async () => {
  vi.useFakeTimers();
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const state = Object.assign(runtimeState(), {
    transcript: [{ type: "assistant", secret: true }],
  });
  const filePath = persistence.getSessionMetadataPath(state);

  persistence.saveSession(state);
  await vi.advanceTimersByTimeAsync(999);
  await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await vi.advanceTimersByTimeAsync(1);
  await persistence.flushAll();

  const saved = JSON.parse(await readFile(filePath, "utf8")) as Record<
    string,
    unknown
  >;
  expect(saved).not.toHaveProperty("query");
  expect(saved).not.toHaveProperty("inputStream");
  expect(saved).not.toHaveProperty("messageBuffer");
  expect(saved).not.toHaveProperty("transcript");
  expect(saved).toMatchObject({
    createdAt: 100,
    isArchived: false,
    lastActivityAt: 200,
  });
});

it("restarts the debounce window and writes the latest mutable state", async () => {
  vi.useFakeTimers();
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const state = runtimeState({ title: "first" });
  const filePath = persistence.getSessionMetadataPath(state);

  persistence.saveSession(state);
  await vi.advanceTimersByTimeAsync(500);
  state.title = "latest";
  persistence.saveSession(state);
  await vi.advanceTimersByTimeAsync(500);
  await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
  await vi.advanceTimersByTimeAsync(500);
  await persistence.flushAll();

  await expect(readFile(filePath, "utf8")).resolves.toContain(
    '"title": "latest"',
  );
});

it("serializes writes for one session so an older write cannot win", async () => {
  const userDataPath = await createTemporaryDirectory();
  let releaseFirstWrite: () => void = () => undefined;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const writes: string[] = [];
  const writeMetadata = async (
    filePath: string,
    metadata: CoworkPersistedSessionMetadata,
  ) => {
    writes.push(metadata.title ?? "");
    if (metadata.title === "first") await firstWriteGate;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(metadata), "utf8");
  };
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
    writeMetadata,
  });
  const state = runtimeState({ title: "first" });
  persistence.saveSession(state);
  const firstFlush = persistence.flushSession(state.sessionId);
  await vi.waitFor(() => expect(writes).toEqual(["first"]));

  state.title = "latest";
  persistence.saveSession(state);
  const finalFlush = persistence.flushAll();
  await Promise.resolve();
  expect(writes).toEqual(["first"]);
  releaseFirstWrite();
  await Promise.all([firstFlush, finalFlush]);

  expect(writes).toEqual(["first", "latest"]);
  await expect(
    readFile(persistence.getSessionMetadataPath(state), "utf8"),
  ).resolves.toContain("latest");
});

it("restores persisted metadata into an idle or archived runtime state", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  persistence.saveSession(runtimeState({ lifecycleState: "running" }));
  persistence.saveSession(
    runtimeState({ lifecycleState: "archived", sessionId: "local_archived_1" }),
  );
  await persistence.flushAll();

  const restored = await persistence.loadSessions();
  const active = restored.find(
    (session) => session.sessionId === "local_session_1",
  );
  const archived = restored.find(
    (session) => session.sessionId === "local_archived_1",
  );

  expect(active).toMatchObject({
    createdAt: 100,
    inputStream: null,
    isFirstTurn: false,
    lastActivityAt: 200,
    lifecycleState: "idle",
    messageBuffer: [],
    query: null,
  });
  expect(active?.resolvedFolders).toEqual([
    { canonical: "/tmp/project", display: "/tmp/project", kind: "local" },
  ]);
  expect(archived?.lifecycleState).toBe("archived");
});

it("resolves official getAutoMemoryDirForSession paths by space/agent/radar", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const accountRoot = path.join(
    userDataPath,
    "local-agent-mode-sessions",
    "account-1",
    "org-1",
  );
  expect(persistence.getAccountStorageDir()).toBe(accountRoot);
  expect(
    persistence.getAutoMemoryDirForSession({ spaceId: "space_xyz" }),
  ).toBe(path.join(accountRoot, "spaces", "space_xyz", "memory"));
  expect(
    persistence.getAutoMemoryDirForSession({ sessionType: "agent" }),
  ).toBe(path.join(accountRoot, "agent", "memory"));
  expect(
    persistence.getAutoMemoryDirForSession({ sessionType: "radar" }),
  ).toBe(path.join(accountRoot, "memory", "memory"));
  expect(persistence.getAutoMemoryDirForSession({})).toBeNull();
  expect(
    persistence.getAutoMemoryDirForSession({
      memoryEnabled: false,
      spaceId: "space_xyz",
    }),
  ).toBeNull();
});

it("deletes both session metadata and its storage directory", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const state = runtimeState();
  const storageDirectory = persistence.getSessionStorageDir(state);
  persistence.saveSession(state);
  await persistence.flushSession(state.sessionId);
  await mkdir(storageDirectory, { recursive: true });
  await writeFile(
    path.join(storageDirectory, "transcript.jsonl"),
    "{}",
    "utf8",
  );

  await persistence.deleteSession(state);

  await expect(
    readFile(persistence.getSessionMetadataPath(state), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    readFile(path.join(storageDirectory, "transcript.jsonl"), "utf8"),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("persists and restores egressAllowedDomains + otelConfig for workspace allowlist", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const state = runtimeState({
    egressAllowedDomains: ["api.example.com", "*.internal.com"],
    otelConfig: {
      endpoint: "https://otel.example.com:4318/v1/traces",
      protocol: "http/protobuf",
    },
  });
  persistence.saveSession(state);
  await persistence.flushAll();

  const saved = JSON.parse(
    await readFile(persistence.getSessionMetadataPath(state), "utf8"),
  ) as Record<string, unknown>;
  expect(saved.egressAllowedDomains).toEqual([
    "api.example.com",
    "*.internal.com",
  ]);
  expect(saved.otelConfig).toMatchObject({
    endpoint: "https://otel.example.com:4318/v1/traces",
    protocol: "http/protobuf",
  });

  const restored = await persistence.loadSessions();
  const session = restored.find((item) => item.sessionId === "local_session_1");
  expect(session?.egressAllowedDomains).toEqual([
    "api.example.com",
    "*.internal.com",
  ]);
  expect(session?.otelConfig).toMatchObject({
    endpoint: "https://otel.example.com:4318/v1/traces",
  });
});

it("persists and restores chromeTabGroupId (official save/get)", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const withId = runtimeState({
    chromeTabGroupId: 42,
    sessionId: "local_tab_group_1",
  });
  const withoutId = runtimeState({
    sessionId: "local_tab_group_none",
  });
  persistence.saveSession(withId);
  persistence.saveSession(withoutId);
  await persistence.flushAll();

  const savedWith = JSON.parse(
    await readFile(persistence.getSessionMetadataPath(withId), "utf8"),
  ) as Record<string, unknown>;
  const savedWithout = JSON.parse(
    await readFile(persistence.getSessionMetadataPath(withoutId), "utf8"),
  ) as Record<string, unknown>;
  expect(savedWith.chromeTabGroupId).toBe(42);
  // undefined is omitted by JSON.stringify — key absent is fine for optional field.
  expect(savedWithout.chromeTabGroupId).toBeUndefined();

  const restored = await persistence.loadSessions();
  expect(
    restored.find((s) => s.sessionId === "local_tab_group_1")?.chromeTabGroupId,
  ).toBe(42);
  expect(
    restored.find((s) => s.sessionId === "local_tab_group_none")
      ?.chromeTabGroupId,
  ).toBeUndefined();
});

it("persists and restores cuAllowedApps/cuGrantFlags (official IXi)", async () => {
  const userDataPath = await createTemporaryDirectory();
  const persistence = new CoworkSessionPersistence({
    accountId: "account-1",
    orgId: "org-1",
    userDataPath,
  });
  const apps = [
    { bundleId: "com.apple.Safari", displayName: "Safari", grantedAt: 1_700 },
  ];
  const flags = {
    clipboardRead: true,
    clipboardWrite: false,
    systemKeyCombos: true,
  };
  const withCu = runtimeState({
    cuAllowedApps: apps,
    cuGrantFlags: flags,
    sessionId: "local_cu_1",
  });
  const withoutCu = runtimeState({
    sessionId: "local_cu_none",
  });
  persistence.saveSession(withCu);
  persistence.saveSession(withoutCu);
  await persistence.flushAll();

  const savedWith = JSON.parse(
    await readFile(persistence.getSessionMetadataPath(withCu), "utf8"),
  ) as Record<string, unknown>;
  expect(savedWith.cuAllowedApps).toEqual(apps);
  expect(savedWith.cuGrantFlags).toEqual(flags);

  const restored = await persistence.loadSessions();
  expect(
    restored.find((s) => s.sessionId === "local_cu_1")?.cuAllowedApps,
  ).toEqual(apps);
  expect(
    restored.find((s) => s.sessionId === "local_cu_1")?.cuGrantFlags,
  ).toEqual(flags);
  expect(
    restored.find((s) => s.sessionId === "local_cu_none")?.cuAllowedApps,
  ).toBeUndefined();
  expect(
    restored.find((s) => s.sessionId === "local_cu_none")?.cuGrantFlags,
  ).toBeUndefined();
});
