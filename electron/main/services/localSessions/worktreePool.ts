/**
 * Official WorktreePool residual (app.asar class pat / Flr / Olr):
 *
 *   isEnabled: ft("1992087837")  → chillingSlothPool
 *   prefs: { reapAfterMs: gi("ccWorktreeReapAfterHours")*3600e3, maxWarm: gi("ccMaxWarmWorktrees") }
 *   classifyWorktree (dat), rankAcquireCandidates (hat), planReap (fat)
 *   tryAcquire / releaseOrRemove / sweep every Llr=30min
 *
 * Product: WorktreeRegistry persists leasedBy/pooledAt; git create/remove via worktreePaths.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Official Llr residual — sweep interval 30 min. */
export const WORKTREE_POOL_SWEEP_MS = 1800 * 1000;
/** Official Ulr residual — recent window 5 min. */
export const WORKTREE_POOL_RECENT_MS = 300 * 1000;
/** Official blr residual — max reaps per sweep. */
export const WORKTREE_POOL_REAP_BATCH = 3;
/** Official keep sentinel filename. */
export const WORKTREE_KEEP_SENTINEL = ".claude-worktree-keep";

export type WorktreePoolEntry = {
  name: string;
  path: string;
  baseRepo: string;
  branch?: string;
  leasedBy: string | null;
  pooledAt?: number;
  createdAt: number;
  lastActivityAt?: number;
};

export type SessionPoolState = {
  isRunning?: boolean;
  isArchived?: boolean;
  isRemote?: boolean;
  worktreePinned?: boolean;
  lastActivityAt: number;
};

export type WorktreeClassifyResult =
  | { eligible: true; lastActivityAt: number; unleased: boolean }
  | { eligible: false; reason: string };

/**
 * Official dat(classifyWorktree) residual.
 */
export function classifyWorktree(
  entry: Pick<WorktreePoolEntry, "leasedBy" | "createdAt">,
  session: SessionPoolState | null | undefined,
  recentMs: number,
  now: number,
): WorktreeClassifyResult {
  if (entry.leasedBy === null) {
    return { eligible: true, lastActivityAt: 0, unleased: true };
  }
  if (session) {
    if (session.isRemote) return { eligible: false, reason: "remote" };
    if (session.worktreePinned) return { eligible: false, reason: "pinned" };
    if (session.isArchived) {
      return { eligible: true, lastActivityAt: session.lastActivityAt, unleased: false };
    }
    if (session.isRunning) return { eligible: false, reason: "running" };
    if (now - session.lastActivityAt < recentMs) {
      return { eligible: false, reason: "recent" };
    }
    return { eligible: true, lastActivityAt: session.lastActivityAt, unleased: false };
  }
  if (now - entry.createdAt < recentMs) {
    return { eligible: false, reason: "recent" };
  }
  return { eligible: true, lastActivityAt: 0, unleased: true };
}

/**
 * Official hat(rankAcquireCandidates) residual.
 */
export function rankAcquireCandidates<
  T extends { pooledAt?: number; unleased?: boolean; lastActivityAt: number },
>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const pa = a.pooledAt;
    const pb = b.pooledAt;
    if (!!pa !== !!pb) return pa ? -1 : 1;
    if (pa && pb) return pb - pa;
    if (a.unleased !== b.unleased) return a.unleased ? -1 : 1;
    return a.lastActivityAt - b.lastActivityAt;
  });
}

/**
 * Official fat(planReap) residual.
 * maxWarm > 0: keep maxWarm newest per baseRepo, reap the rest.
 * maxWarm === 0: reap non-newest if older than reapAfterMs.
 */
export function planReap<
  T extends { baseRepo: string; lastActivityAt: number; name: string },
>(
  entries: T[],
  opts: { maxWarm: number; reapAfterMs: number; now: number },
): T[] {
  const byRepo = new Map<string, T[]>();
  for (const e of entries) {
    const list = byRepo.get(e.baseRepo) ?? [];
    list.push(e);
    byRepo.set(e.baseRepo, list);
  }
  const out: T[] = [];
  for (const list of byRepo.values()) {
    list.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    if (opts.maxWarm > 0) {
      out.push(...list.slice(opts.maxWarm));
    } else {
      for (let i = 1; i < list.length; i++) {
        const e = list[i]!;
        if (opts.now - e.lastActivityAt >= opts.reapAfterMs) out.push(e);
      }
    }
  }
  return out;
}

export type WorktreeRegistryStore = {
  load: () => WorktreePoolEntry[];
  save: (entries: WorktreePoolEntry[]) => void;
};

export function createJsonWorktreeRegistry(filePath: string): WorktreeRegistryStore {
  return {
    load: () => {
      try {
        if (!fs.existsSync(filePath)) return [];
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return Array.isArray(raw) ? (raw as WorktreePoolEntry[]) : [];
      } catch {
        return [];
      }
    },
    save: (entries) => {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf8");
      } catch {
        /* best-effort */
      }
    },
  };
}

export type WorktreePoolDeps = {
  registry: WorktreeRegistryStore;
  isEnabled: () => boolean;
  prefs: () => { reapAfterMs: number; maxWarm: number };
  getSessionPoolState: (sessionId: string) => SessionPoolState | null;
  hasLoadedSessions: () => boolean;
  detachWorktreeFromSession: (sessionId: string, worktreePath?: string) => void;
  /** Attach leased worktree fields onto session. */
  attachWorktreeToSession: (
    sessionId: string,
    entry: WorktreePoolEntry,
  ) => void | Promise<void>;
  dirExists?: (p: string) => Promise<boolean>;
  hasKeepSentinel?: (worktreePath: string) => Promise<boolean>;
  isWorktreeClean?: (entry: WorktreePoolEntry) => Promise<boolean>;
  removeWorktree?: (entry: WorktreePoolEntry) => Promise<void>;
  resetWorktreeToClean?: (entry: WorktreePoolEntry) => Promise<boolean>;
  detachWorktreeHead?: (entry: WorktreePoolEntry) => Promise<void>;
  now?: () => number;
  log?: (...args: unknown[]) => void;
};

async function defaultDirExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function defaultHasKeep(p: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(p, WORKTREE_KEEP_SENTINEL));
    return true;
  } catch {
    return false;
  }
}

async function defaultIsClean(entry: WorktreePoolEntry): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: entry.path,
      timeout: 15_000,
    });
    return String(stdout ?? "").trim().length === 0;
  } catch {
    return false;
  }
}

async function defaultRemove(entry: WorktreePoolEntry): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", entry.path],
      { cwd: entry.baseRepo, timeout: 30_000 },
    );
  } catch {
    try {
      await fs.promises.rm(entry.path, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function defaultResetClean(entry: WorktreePoolEntry): Promise<boolean> {
  try {
    await execFileAsync("git", ["reset", "--hard"], {
      cwd: entry.path,
      timeout: 30_000,
    });
    await execFileAsync("git", ["clean", "-fd"], {
      cwd: entry.path,
      timeout: 30_000,
    });
    return await defaultIsClean(entry);
  } catch {
    return false;
  }
}

async function defaultDetachHead(entry: WorktreePoolEntry): Promise<void> {
  try {
    await execFileAsync("git", ["checkout", "--detach"], {
      cwd: entry.path,
      timeout: 15_000,
    });
  } catch {
    /* best-effort */
  }
}

export class WorktreePool {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private initialSweepTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping = false;
  private mutex: Promise<unknown> = Promise.resolve();
  private readonly deps: WorktreePoolDeps;
  private readonly now: () => number;

  constructor(deps: WorktreePoolDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.mutex.then(fn, fn);
    this.mutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next as Promise<T>;
  }

  isEnabled(): boolean {
    return this.deps.isEnabled() === true;
  }

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, WORKTREE_POOL_SWEEP_MS);
    this.initialSweepTimer = setTimeout(() => {
      void this.sweep();
    }, 60_000);
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.initialSweepTimer) {
      clearTimeout(this.initialSweepTimer);
      this.initialSweepTimer = null;
    }
  }

  listAll(): WorktreePoolEntry[] {
    return this.deps.registry.load();
  }

  private saveAll(entries: WorktreePoolEntry[]): void {
    this.deps.registry.save(entries);
  }

  upsert(entry: WorktreePoolEntry): void {
    const all = this.listAll().filter((e) => e.name !== entry.name && e.path !== entry.path);
    all.push(entry);
    this.saveAll(all);
  }

  private removeByName(name: string): void {
    this.saveAll(this.listAll().filter((e) => e.name !== name));
  }

  private eligibleEntries(baseRepo?: string): Array<
    WorktreePoolEntry & { lastActivityAt: number; unleased: boolean }
  > {
    const now = this.now();
    const out: Array<WorktreePoolEntry & { lastActivityAt: number; unleased: boolean }> = [];
    for (const entry of this.listAll()) {
      if (baseRepo && path.resolve(entry.baseRepo) !== path.resolve(baseRepo)) continue;
      const session = entry.leasedBy
        ? this.deps.getSessionPoolState(entry.leasedBy)
        : null;
      const classified = classifyWorktree(
        entry,
        session,
        WORKTREE_POOL_RECENT_MS,
        now,
      );
      if (!classified.eligible) continue;
      out.push({
        ...entry,
        lastActivityAt: classified.lastActivityAt || entry.pooledAt || entry.createdAt,
        unleased: classified.unleased,
      });
    }
    return out;
  }

  tryAcquire(input: {
    baseRepo: string;
    sessionId: string;
    preferPath?: string;
    sourceBranch?: string;
  }): Promise<WorktreePoolEntry | null> {
    if (!this.isEnabled() || !this.deps.hasLoadedSessions()) {
      return Promise.resolve(null);
    }
    return this.withLock(() => this.tryAcquireLocked(input));
  }

  private async tryAcquireLocked(input: {
    baseRepo: string;
    sessionId: string;
    preferPath?: string;
  }): Promise<WorktreePoolEntry | null> {
    const dirExists = this.deps.dirExists ?? defaultDirExists;
    const hasKeep = this.deps.hasKeepSentinel ?? defaultHasKeep;
    const isClean = this.deps.isWorktreeClean ?? defaultIsClean;
    const candidates = rankAcquireCandidates(this.eligibleEntries(input.baseRepo));
    if (candidates.length === 0) return null;
    if (input.preferPath) {
      const prefer = path.normalize(input.preferPath);
      const idx = candidates.findIndex((c) => path.normalize(c.path) === prefer);
      if (idx > 0) {
        const [hit] = candidates.splice(idx, 1);
        if (hit) candidates.unshift(hit);
      }
    }
    let checked = 0;
    for (const candidate of candidates) {
      checked++;
      if (!(await dirExists(candidate.path))) {
        this.deps.log?.(
          `[WorktreePool] Pruning orphaned store entry ${candidate.name} (directory gone)`,
        );
        this.removeByName(candidate.name);
        if (candidate.leasedBy) {
          this.deps.detachWorktreeFromSession(candidate.leasedBy, candidate.path);
        }
        continue;
      }
      if (await hasKeep(candidate.path)) continue;
      if (!(await isClean(candidate))) {
        // Official: clear pooledAt when dirty
        const all = this.listAll();
        const hit = all.find((e) => e.name === candidate.name);
        if (hit?.pooledAt) {
          hit.pooledAt = undefined;
          this.saveAll(all);
        }
        continue;
      }
      const prevLease = candidate.leasedBy;
      const all = this.listAll();
      const hit = all.find((e) => e.name === candidate.name);
      if (!hit) continue;
      hit.leasedBy = input.sessionId;
      hit.pooledAt = undefined;
      this.saveAll(all);
      if (prevLease && prevLease !== input.sessionId) {
        this.deps.detachWorktreeFromSession(prevLease, candidate.path);
      }
      await this.deps.attachWorktreeToSession(input.sessionId, hit);
      this.deps.log?.(
        `[WorktreePool] Reused worktree ${hit.name} for session ${input.sessionId} (was leased by ${prevLease ?? "none"})`,
      );
      return hit;
    }
    this.deps.log?.(
      `[WorktreePool] No reusable worktree for ${input.baseRepo} (${checked}/${candidates.length} candidates checked)`,
    );
    return null;
  }

  /**
   * Register a freshly created worktree as leased by session.
   */
  registerLease(entry: Omit<WorktreePoolEntry, "leasedBy" | "createdAt"> & {
    leasedBy: string;
    createdAt?: number;
  }): void {
    this.upsert({
      ...entry,
      leasedBy: entry.leasedBy,
      createdAt: entry.createdAt ?? this.now(),
      pooledAt: undefined,
    });
  }

  async releaseOrRemove(sessionId: string): Promise<void> {
    if (!this.isEnabled()) {
      const entry = this.listAll().find((e) => e.leasedBy === sessionId);
      if (entry) {
        await (this.deps.removeWorktree ?? defaultRemove)(entry);
        this.removeByName(entry.name);
        this.deps.detachWorktreeFromSession(sessionId, entry.path);
      }
      return;
    }
    return this.withLock(() => this.releaseOrRemoveLocked(sessionId));
  }

  private async releaseOrRemoveLocked(sessionId: string): Promise<void> {
    const entry = this.listAll().find((e) => e.leasedBy === sessionId);
    if (!entry) return;
    const hasKeep = this.deps.hasKeepSentinel ?? defaultHasKeep;
    const isClean = this.deps.isWorktreeClean ?? defaultIsClean;
    const reset = this.deps.resetWorktreeToClean ?? defaultResetClean;
    const remove = this.deps.removeWorktree ?? defaultRemove;
    const detachHead = this.deps.detachWorktreeHead ?? defaultDetachHead;

    if (await hasKeep(entry.path)) {
      this.deps.log?.(`[WorktreePool] ${entry.name} has keep sentinel; leaving on disk`);
      return;
    }
    if (!(await isClean(entry))) {
      if (!(await reset(entry))) {
        await remove(entry);
        this.removeByName(entry.name);
        this.deps.detachWorktreeFromSession(sessionId, entry.path);
        return;
      }
      this.deps.log?.(
        `[WorktreePool] Reset dirty worktree ${entry.name} to clean for pooling`,
      );
    }
    // Re-check lease
    const current = this.listAll().find((e) => e.name === entry.name);
    if (!current || current.leasedBy !== sessionId) {
      this.deps.log?.(
        `[WorktreePool] Skipping release of ${entry.name} — lease changed during reset`,
      );
      return;
    }
    await detachHead(current);
    current.leasedBy = null;
    current.pooledAt = this.now();
    this.upsert(current);
    this.deps.detachWorktreeFromSession(sessionId, current.path);
    this.deps.log?.(
      `[WorktreePool] Released worktree ${current.name} to pool (was leased by ${sessionId})`,
    );
  }

  async sweep(): Promise<void> {
    if (this.sweeping || !this.isEnabled()) return;
    if (!this.deps.hasLoadedSessions()) {
      this.deps.log?.("[WorktreePool] sweep: skipping (sessions not loaded)");
      return;
    }
    this.sweeping = true;
    try {
      const { reapAfterMs, maxWarm } = this.deps.prefs();
      const dirExists = this.deps.dirExists ?? defaultDirExists;
      const hasKeep = this.deps.hasKeepSentinel ?? defaultHasKeep;
      const isClean = this.deps.isWorktreeClean ?? defaultIsClean;
      const remove = this.deps.removeWorktree ?? defaultRemove;
      const detachHead = this.deps.detachWorktreeHead ?? defaultDetachHead;
      const now = this.now();

      const eligible: Array<WorktreePoolEntry & { lastActivityAt: number }> = [];
      for (const entry of this.eligibleEntries()) {
        if (!(await dirExists(entry.path))) {
          this.removeByName(entry.name);
          if (entry.leasedBy) {
            this.deps.detachWorktreeFromSession(entry.leasedBy, entry.path);
          }
          continue;
        }
        if (await hasKeep(entry.path)) continue;
        if (!(await isClean(entry))) continue;
        eligible.push(entry);
      }

      const toReap = planReap(eligible, { maxWarm, reapAfterMs, now })
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
        .slice(0, WORKTREE_POOL_REAP_BATCH);
      const reapNames = new Set(toReap.map((e) => e.name));

      // Survivors: ensure pooled / detached
      for (const entry of eligible) {
        if (reapNames.has(entry.name)) continue;
        await this.withLock(async () => {
          const live = this.listAll().find((e) => e.name === entry.name);
          if (!live) return;
          if (live.leasedBy) {
            const st = this.deps.getSessionPoolState(live.leasedBy);
            if (st && (st.isRunning || st.worktreePinned)) return;
            try {
              await detachHead(live);
              const sid = live.leasedBy;
              live.leasedBy = null;
              if (!live.pooledAt) live.pooledAt = now;
              this.upsert(live);
              if (sid) this.deps.detachWorktreeFromSession(sid, live.path);
            } catch (error) {
              this.deps.log?.(
                `[WorktreePool] survivor-loop failed for ${live.name}`,
                error,
              );
            }
          } else if (!live.pooledAt) {
            live.pooledAt = now;
            this.upsert(live);
          }
        });
      }

      for (const entry of toReap) {
        await this.withLock(async () => {
          const live = this.listAll().find((e) => e.name === entry.name);
          if (!live) return;
          try {
            if (live.leasedBy) {
              this.deps.detachWorktreeFromSession(live.leasedBy, live.path);
            }
            await remove(live);
            this.removeByName(live.name);
            this.deps.log?.(`[WorktreePool] Reaped ${live.name}`);
          } catch (error) {
            this.deps.log?.(`[WorktreePool] reap failed for ${entry.name}`, error);
          }
        });
      }
    } finally {
      this.sweeping = false;
    }
  }
}
