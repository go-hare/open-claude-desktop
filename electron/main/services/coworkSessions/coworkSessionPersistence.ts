import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR,
  resolveCoworkAutoMemoryDir,
  type CoworkAutoMemorySessionIdentity,
} from "./coworkAutoMemoryPaths";
import { writeCoworkMetadataAtomically } from "./coworkSessionPersistenceWriter";
import type {
  CoworkDetectedFile,
  CoworkPersistedSessionMetadata,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

type SessionPathIdentity = Pick<
  CoworkSessionRuntimeState,
  "sessionId" | "sessionType"
>;

type PendingWrite = {
  session: CoworkSessionRuntimeState;
  timer: ReturnType<typeof setTimeout>;
};

export type CoworkMetadataWriter = (
  filePath: string,
  metadata: CoworkPersistedSessionMetadata,
) => Promise<void>;

export type CoworkSessionPersistenceOptions = {
  accountId: string;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  orgId: string;
  userDataPath: string;
  writeMetadata?: CoworkMetadataWriter;
};

const defaultDebounceMs = 1_000;
/** Official Kb. */
const storageDirectoryName = COWORK_LOCAL_AGENT_MODE_SESSIONS_DIR;

function safeSegment(value: string, label: string): string {
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  throw new Error(`Invalid ${label}: ${value}`);
}

function isDetectedFile(value: unknown): value is CoworkDetectedFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<CoworkDetectedFile>;
  return (
    typeof file.fileName === "string" &&
    typeof file.hostPath === "string" &&
    typeof file.timestamp === "number"
  );
}

function isPersistedMetadata(
  value: unknown,
): value is CoworkPersistedSessionMetadata {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<CoworkPersistedSessionMetadata>;
  return (
    typeof session.sessionId === "string" &&
    typeof session.processName === "string" &&
    typeof session.cwd === "string" &&
    typeof session.vmProcessName === "string" &&
    typeof session.createdAt === "number" &&
    typeof session.lastActivityAt === "number" &&
    typeof session.isArchived === "boolean" &&
    Array.isArray(session.userSelectedFolders) &&
    session.userSelectedFolders.every((folder) => typeof folder === "string")
  );
}

function optionalMetadata(
  session: CoworkSessionRuntimeState,
): Partial<CoworkPersistedSessionMetadata> {
  return {
    approvedToolNames: session.approvedToolNames,
    chromeAllowedDomains:
      session.chromeAllowedDomains && session.chromeAllowedDomains.length > 0
        ? [...session.chromeAllowedDomains]
        : undefined,
    chromePermissionMode: session.chromePermissionMode,
    // Official saveSession writes chromePermsBeforeUnsupervised even when
    // domains are empty/undefined (snapshot of current mode+domains).
    chromePermsBeforeUnsupervised: session.chromePermsBeforeUnsupervised
      ? {
          mode: session.chromePermsBeforeUnsupervised.mode,
          domains: session.chromePermsBeforeUnsupervised.domains
            ? [...session.chromePermsBeforeUnsupervised.domains]
            : undefined,
        }
      : undefined,
    // Official saveSession: chromeTabGroupId:s.chromeTabGroupId
    chromeTabGroupId: session.chromeTabGroupId,
    // Official saveSession: cuAllowedApps:s.cuAllowedApps, cuGrantFlags:s.cuGrantFlags
    cuAllowedApps: session.cuAllowedApps
      ? session.cuAllowedApps.map((app) => ({ ...app }))
      : undefined,
    cuGrantFlags: session.cuGrantFlags
      ? { ...session.cuGrantFlags }
      : undefined,
    cliSessionId: session.cliSessionId,
    egressAllowedDomains:
      session.egressAllowedDomains && session.egressAllowedDomains.length > 0
        ? [...session.egressAllowedDomains]
        : undefined,
    enabledMcpTools: session.enabledMcpTools,
    error: session.error,
    fileDeleteApprovedMounts:
      session.fileDeleteApprovedMounts &&
      session.fileDeleteApprovedMounts.length > 0
        ? [...session.fileDeleteApprovedMounts]
        : undefined,
    hostLoopMode: session.hostLoopMode,
    initialMessage: session.initialMessage,
    isAgentCompleted: session.isAgentCompleted,
    isStarred: session.isStarred,
    memoryEnabled: session.memoryEnabled,
    model: session.model,
    overrideLabel: session.overrideLabel,
    otelConfig: session.otelConfig,
    parentSessionId: session.parentSessionId,
    pendingRewindTo: session.pendingRewindTo,
    pendingSystemReminder: session.pendingSystemReminder,
    permissionMode: session.permissionMode,
    promptSuggestion: session.promptSuggestion,
    remoteMcpServersConfig: session.remoteMcpServersConfig,
    scheduledTaskId: session.scheduledTaskId,
    sessionType: session.sessionType,
    spaceId: session.spaceId,
    spaceIdSetBy: session.spaceIdSetBy,
    systemPrompt: session.systemPrompt,
    title: session.title,
    titleSource: session.titleSource,
    userSelectedProjectUuids: session.userSelectedProjectUuids,
  };
}

function toPersistedMetadata(
  session: CoworkSessionRuntimeState,
): CoworkPersistedSessionMetadata {
  const fsDetectedFiles = [...session.fsDetectedFiles.values()];
  return {
    ...optionalMetadata(session),
    createdAt: session.createdAt,
    cwd: session.cwd,
    fsDetectedFiles: fsDetectedFiles.length > 0 ? fsDetectedFiles : undefined,
    isArchived: session.lifecycleState === "archived",
    lastActivityAt: session.lastActivityAt,
    pendingNotifications:
      session.pendingNotifications.length > 0
        ? session.pendingNotifications
        : undefined,
    processName: session.processName,
    sessionId: session.sessionId,
    userSelectedFolders: session.resolvedFolders.map(
      (folder) => folder.canonical ?? folder.display,
    ),
    vmProcessName: session.vmProcessName,
  };
}

function restoreRuntime(
  metadata: CoworkPersistedSessionMetadata,
): CoworkSessionRuntimeState {
  const { fsDetectedFiles, isArchived, userSelectedFolders, ...shared } =
    metadata;
  const detectedFiles = (fsDetectedFiles ?? []).filter(isDetectedFile);
  return {
    ...shared,
    fsDetectedFiles: new Map(
      detectedFiles.map((file) => [file.hostPath, file]),
    ),
    inputStream: null,
    isFirstTurn: false,
    lifecycleState: isArchived ? "archived" : "idle",
    messageBuffer: [],
    pendingNotifications: metadata.pendingNotifications ?? [],
    query: null,
    resolvedFolders: userSelectedFolders.map((folder) => ({
      canonical: folder,
      display: folder,
      kind: "local",
    })),
  };
}

export class CoworkSessionPersistence {
  private readonly accountStorageDir: string;
  private readonly activeWrites = new Map<string, Promise<void>>();
  private readonly debounceMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly pendingWrites = new Map<string, PendingWrite>();
  private readonly writeMetadata: CoworkMetadataWriter;

  constructor(options: CoworkSessionPersistenceOptions) {
    const accountId = safeSegment(options.accountId, "accountId");
    const orgId = safeSegment(options.orgId, "orgId");
    this.accountStorageDir = path.join(
      options.userDataPath,
      storageDirectoryName,
      accountId,
      orgId,
    );
    this.debounceMs = options.debounceMs ?? defaultDebounceMs;
    this.onError = options.onError ?? (() => undefined);
    this.writeMetadata = options.writeMetadata ?? writeCoworkMetadataAtomically;
  }

  getAccountStorageDir(): string {
    return this.accountStorageDir;
  }

  /**
   * Official LocalAgentModeSessionManager.getAutoMemoryDirForSession.
   * Requires identity (accountStorageDir already scoped to account/org).
   */
  getAutoMemoryDirForSession(
    session: CoworkAutoMemorySessionIdentity,
  ): string | null {
    return resolveCoworkAutoMemoryDir(this.accountStorageDir, session);
  }

  getSessionMetadataPath(session: SessionPathIdentity): string {
    const sessionId = safeSegment(session.sessionId, "sessionId");
    const directory =
      session.sessionType === "agent"
        ? path.join(this.accountStorageDir, "agent")
        : this.accountStorageDir;
    return path.join(directory, `${sessionId}.json`);
  }

  getSessionStorageDir(session: SessionPathIdentity): string {
    const metadataPath = this.getSessionMetadataPath(session);
    return metadataPath.slice(0, -path.extname(metadataPath).length);
  }

  saveSession(session: CoworkSessionRuntimeState): void {
    const existing = this.pendingWrites.get(session.sessionId);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingWrites.delete(session.sessionId);
      void this.startWrite(session).catch(() => undefined);
    }, this.debounceMs);
    this.pendingWrites.set(session.sessionId, { session, timer });
  }

  async flushSession(sessionId: string): Promise<void> {
    const pending = this.pendingWrites.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingWrites.delete(sessionId);
      await this.startWrite(pending.session);
      return;
    }
    await this.activeWrites.get(sessionId);
  }

  async flushAll(): Promise<void> {
    const pending = [...this.pendingWrites.values()];
    this.pendingWrites.clear();
    for (const write of pending) clearTimeout(write.timer);
    const started = pending.map((write) => this.startWrite(write.session));
    const active = [...new Set([...this.activeWrites.values(), ...started])];
    await Promise.all(active);
  }

  async deleteSession(session: SessionPathIdentity): Promise<void> {
    const pending = this.pendingWrites.get(session.sessionId);
    if (pending) clearTimeout(pending.timer);
    this.pendingWrites.delete(session.sessionId);
    await this.activeWrites.get(session.sessionId)?.catch(() => undefined);
    await Promise.all([
      rm(this.getSessionMetadataPath(session), { force: true }),
      rm(this.getSessionStorageDir(session), { force: true, recursive: true }),
    ]);
  }

  async loadSessions(): Promise<CoworkSessionRuntimeState[]> {
    const paths = [
      ...(await this.listMetadataFiles(this.accountStorageDir)),
      ...(await this.listMetadataFiles(
        path.join(this.accountStorageDir, "agent"),
      )),
    ];
    const sessions = new Map<string, CoworkSessionRuntimeState>();
    for (const filePath of paths) {
      const metadata = await this.readMetadata(filePath);
      if (metadata && !sessions.has(metadata.sessionId)) {
        sessions.set(metadata.sessionId, restoreRuntime(metadata));
      }
    }
    return [...sessions.values()];
  }

  private startWrite(session: CoworkSessionRuntimeState): Promise<void> {
    const previous = this.activeWrites.get(session.sessionId);
    const preceding = previous ? previous.catch(() => undefined) : undefined;
    const promise = Promise.resolve(preceding)
      .then(() => this.writeSessionToDisk(session))
      .catch((error) => {
        this.onError(error);
        throw error;
      })
      .finally(() => {
        if (this.activeWrites.get(session.sessionId) === promise) {
          this.activeWrites.delete(session.sessionId);
        }
      });
    this.activeWrites.set(session.sessionId, promise);
    return promise;
  }

  private async writeSessionToDisk(
    session: CoworkSessionRuntimeState,
  ): Promise<void> {
    const filePath = this.getSessionMetadataPath(session);
    await this.writeMetadata(filePath, toPersistedMetadata(session));
  }

  private async listMetadataFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith("local_") &&
          entry.name.endsWith(".json"),
      )
      .map((entry) => path.join(directory, entry.name));
  }

  private async readMetadata(
    filePath: string,
  ): Promise<CoworkPersistedSessionMetadata | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      return isPersistedMetadata(parsed) ? parsed : null;
    } catch (error) {
      this.onError(error);
      return null;
    }
  }
}
