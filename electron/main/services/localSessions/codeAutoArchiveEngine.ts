/**
 * Official AutoArchiveEngine residual (app.asar class vlr / Glr):
 *   start() → setInterval(sweep, 300s) + initial sweep after 30s
 *   sweep() only when gi("ccAutoArchiveOnPrClose")
 *   archive candidates: !isArchived && !isRunning && (all prs terminal OR stale check)
 *   terminal states: merged | closed (case-insensitive)
 *   archiveSession(id, { cleanupWorktree: true })
 *
 * Product Code LocalSessions:
 *   - Prefer session.prs[] (official residual) when present — all terminal → archive
 *   - Else look up PR state via getPrStateForBranch(worktree/cwd) and cache into prs
 *   - prCheckedAt throttle 1h between network lookups per session
 *   - batch size 10
 */

import type {
  LocalSession,
  LocalSessionPrRef,
  LocalSessionStore,
} from "./localSessionStore";

const SWEEP_MS = 300 * 1000;
const INITIAL_SWEEP_MS = 30 * 1000;
const PR_CHECK_TTL_MS = 3600 * 1000;
const BATCH = 10;

export function isTerminalPrState(state: string | null | undefined): boolean {
  const s = state?.toLowerCase();
  return s === "merged" || s === "closed";
}

/** Official: every tracked PR is terminal (merged/closed), or merged flag. */
export function areAllPrsTerminal(
  prs: LocalSessionPrRef[] | null | undefined,
): boolean {
  if (!Array.isArray(prs) || prs.length === 0) return false;
  return prs.every(
    (pr) => pr.merged === true || isTerminalPrState(pr.state),
  );
}

export type CodeAutoArchiveLookup = (
  session: LocalSession,
) => Promise<LocalSessionPrRef[] | null>;

export type CodeAutoArchiveEngineOptions = {
  store: LocalSessionStore;
  /** Official gi("ccAutoArchiveOnPrClose"). */
  isEnabled: () => boolean;
  /**
   * Network lookup when session.prs is missing/non-terminal.
   * Should return the full PR list for the session (official session.prs shape).
   */
  lookupPrs: CodeAutoArchiveLookup;
  /** Persist refreshed prs back onto the session (official field write). */
  writePrs?: (
    sessionId: string,
    prs: LocalSessionPrRef[],
  ) => void | Promise<void>;
  /** Archive + optional worktree cleanup. */
  archiveSession: (
    sessionId: string,
    options?: { cleanupWorktree?: boolean },
  ) => Promise<boolean> | boolean;
  log?: (message: string, error?: unknown) => void;
  now?: () => number;
};

export class CodeAutoArchiveEngine {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping = false;
  private readonly prCheckedAt = new Map<string, number>();
  private readonly opts: CodeAutoArchiveEngineOptions;
  private readonly now: () => number;
  private readonly log: (message: string, error?: unknown) => void;

  constructor(options: CodeAutoArchiveEngineOptions) {
    this.opts = options;
    this.now = options.now ?? Date.now;
    this.log =
      options.log
      ?? ((message, error) => {
        if (error) console.error(message, error);
        else console.info(message);
      });
  }

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
    this.initialTimer = setTimeout(() => {
      void this.sweep();
    }, INITIAL_SWEEP_MS);
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
  }

  async sweep(): Promise<void> {
    if (this.sweeping || !this.opts.isEnabled()) return;
    this.sweeping = true;
    try {
      const sessions = this.opts.store.getAll(true);
      const t = this.now();
      const candidates = sessions.filter((session) => {
        if (session.archived || session.isRunning) return false;
        if (!session.cwd && !session.worktreePath && !session.originCwd) return false;
        // Official fast path: cached session.prs all terminal → archive without wait.
        if (areAllPrsTerminal(session.prs)) return true;
        const last = this.prCheckedAt.get(session.id) ?? 0;
        return t - last >= PR_CHECK_TTL_MS;
      });
      for (let i = 0; i < candidates.length; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH);
        await Promise.all(batch.map((session) => this.checkAndArchive(session, t)));
      }
    } catch (error) {
      this.log("[CodeAutoArchiveEngine] Sweep failed", error);
    } finally {
      this.sweeping = false;
    }
  }

  private async checkAndArchive(session: LocalSession, t: number): Promise<void> {
    try {
      // 1) Official residual: session.prs already known terminal → archive now.
      if (areAllPrsTerminal(session.prs)) {
        this.log(
          `[CodeAutoArchiveEngine] Archiving ${session.id} (session.prs all terminal)`,
        );
        await this.opts.archiveSession(session.id, { cleanupWorktree: true });
        this.prCheckedAt.set(session.id, t);
        return;
      }

      // 2) Network refresh → write session.prs, then decide.
      const prs = await this.opts.lookupPrs(session);
      if (prs == null) {
        // 5 min backoff for unknown (API miss / no PR).
        this.prCheckedAt.set(session.id, t - PR_CHECK_TTL_MS + 5 * 60_000);
        return;
      }
      this.prCheckedAt.set(session.id, t);
      if (this.opts.writePrs) {
        try {
          await this.opts.writePrs(session.id, prs);
        } catch (error) {
          this.log(
            `[CodeAutoArchiveEngine] writePrs failed for ${session.id}`,
            error,
          );
        }
      }
      if (!areAllPrsTerminal(prs)) return;
      this.log(
        `[CodeAutoArchiveEngine] Archiving ${session.id} (PR terminal after lookup)`,
      );
      await this.opts.archiveSession(session.id, { cleanupWorktree: true });
    } catch (error) {
      this.log(
        `[CodeAutoArchiveEngine] checkAndArchive failed for ${session.id}`,
        error,
      );
    }
  }
}
