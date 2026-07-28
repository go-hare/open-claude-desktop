/**
 * Official AutoFixEngine residual (app.asar class Klr / Vlr):
 *
 *   start(): interval Ylr=60s + first sweep @15s; on session_updated kick
 *   sweep(): sessions where autoFixEnabled && !archived && prs.length > 0
 *   checkSession(): open PR → getPrChecks + getPrReviews + getPrIssueComments
 *     + review line comments → new CI failures / merge conflict / unseen
 *     comments → sendMessage with <ci-monitor-event>…</ci-monitor-event>
 *
 *   Plr residual: keep comments where author_association is OWNER|MEMBER|
 *   COLLABORATOR, drop Bot user.type, drop empty body, drop self-login.
 *
 * Product: LocalSessionStore + injected GitHub/PR adapters. Does not invent
 * autofix without session.autoFixEnabled.
 */

import type { LocalSession, LocalSessionStore } from "./localSessionStore";

const SWEEP_MS = 60_000;
const FIRST_SWEEP_MS = 15_000;
const BATCH = 5;
const MERGE_CONFLICT_KEY = "__merge_conflict__";

export type CodeAutoFixPrCheck = {
  name?: string;
  bucket?: string;
  conclusion?: string;
  status?: string;
};

export type CodeAutoFixPrChecksResult = {
  success?: boolean;
  ok?: boolean;
  checks?: CodeAutoFixPrCheck[];
  prState?: string;
  mergeable?: string;
  error?: string;
};

export type CodeAutoFixComment = {
  id?: string | number;
  dedupId?: string;
  author?: string;
  body?: string;
  path?: string;
  line?: number;
  state?: string;
  userType?: string;
  authorAssociation?: string;
};

export type CodeAutoFixEngineDeps = {
  store: LocalSessionStore;
  getPrChecks: (
    cwd: string,
    prNumber: number,
    repo?: string,
  ) => Promise<CodeAutoFixPrChecksResult>;
  /**
   * Official getPrReviewComments residual — PR review *line* comments
   * (pulls/{n}/comments). Soft-skip on failure.
   */
  getPrReviewComments?: (
    cwd: string,
    prNumber: number,
    repo?: string,
  ) => Promise<{ success?: boolean; comments?: CodeAutoFixComment[] }>;
  /**
   * Official getPrReviews residual — review summaries (pulls/{n}/reviews).
   * Body may be the overall review note; state = APPROVED / CHANGES_REQUESTED / …
   */
  getPrReviews?: (
    cwd: string,
    prNumber: number,
    repo?: string,
  ) => Promise<{ success?: boolean; comments?: CodeAutoFixComment[] }>;
  /**
   * Official getPrIssueComments residual — issue-thread comments
   * (issues/{n}/comments). Soft-skip on failure.
   */
  getPrIssueComments?: (
    cwd: string,
    prNumber: number,
    repo?: string,
  ) => Promise<{ success?: boolean; comments?: CodeAutoFixComment[] }>;
  getGhLogin?: () => Promise<string | null>;
  sendMessage: (sessionId: string, text: string) => Promise<void> | void;
  log?: (...args: unknown[]) => void;
  now?: () => number;
};

/** Official Plr residual associations that are actionable for AutoFix. */
const PLR_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Official Plr residual — filter review/issue comments before wake.
 * Drop bots, empty bodies, self-authored, and non OWNER|MEMBER|COLLABORATOR
 * when association is present. Missing association is kept (partial API).
 */
export function filterAutoFixComments(
  comments: CodeAutoFixComment[],
  opts?: { login?: string | null; seen?: Set<string> },
): CodeAutoFixComment[] {
  const login = opts?.login ?? null;
  const seen = opts?.seen ?? new Set<string>();
  return comments.filter((c) => {
    const id = String(c.dedupId ?? c.id ?? "");
    if (!id || seen.has(id)) return false;
    if (login && c.author === login) return false;
    if ((c.body ?? "").trim().length === 0) return false;
    const userType = (c.userType ?? "").toLowerCase();
    if (userType === "bot") return false;
    const assoc = (c.authorAssociation ?? "").toUpperCase();
    if (assoc && !PLR_ASSOCIATIONS.has(assoc)) return false;
    return true;
  });
}

function prKey(prNumber: number, repo?: string): string {
  return `${repo ?? ""}#${prNumber}`;
}

function isTerminalPrState(state: string | null | undefined): boolean {
  if (!state) return false;
  const u = state.toUpperCase();
  return u === "MERGED" || u === "CLOSED";
}

function failingCheckNames(checks: CodeAutoFixPrCheck[]): string[] {
  const names: string[] = [];
  for (const check of checks) {
    const bucket = (check.bucket ?? "").toLowerCase();
    const conclusion = (check.conclusion ?? "").toLowerCase();
    const status = (check.status ?? "").toLowerCase();
    const failed =
      bucket === "fail"
      || conclusion === "failure"
      || conclusion === "timed_out"
      || conclusion === "cancelled"
      || (status === "completed" && conclusion === "failure");
    if (failed && check.name) names.push(check.name);
  }
  return [...new Set(names)];
}

/**
 * Official qlr residual — CI monitor wake prompt.
 */
export function buildAutoFixWakeMessage(input: {
  failedChecks: string[];
  hasMergeConflict: boolean;
  comments: Array<{ author?: string; body?: string; path?: string; line?: number; state?: string }>;
  prNumber: number;
  repo?: string;
}): string {
  const n = input.repo ? `${input.repo} PR #${input.prNumber}` : `PR #${input.prNumber}`;
  const o = input.repo ? ` --repo ${input.repo}` : "";
  const parts: string[] = [];
  if (input.failedChecks.length > 0) {
    const quoted = input.failedChecks.map((c) => `"${c}"`).join(", ");
    const g = input.failedChecks.length === 1 ? "check" : "checks";
    parts.push(
      `CI ${g} ${quoted} failed on ${n}. Run \`gh pr checks ${input.prNumber}${o}\` to see details, then fix the failing ${g}.`,
    );
  }
  if (input.hasMergeConflict) {
    parts.push(`${n} has merge conflicts. Please resolve the conflicts so the PR can be merged.`);
  }
  if (input.comments.length > 0) {
    const a = input.comments.length === 1 ? "comment" : "comments";
    const lines = input.comments
      .map((c) => {
        if (c.path) {
          const loc = c.line ? `${c.path}:${c.line}` : c.path;
          return `- ${c.author ?? "reviewer"} on ${loc}: ${c.body ?? ""}`;
        }
        const st = c.state ? ` (${c.state.toLowerCase().replace(/_/g, " ")})` : "";
        return `- ${c.author ?? "reviewer"}${st}: ${c.body ?? ""}`;
      })
      .join("\n");
    parts.push(
      `${n} has ${input.comments.length} new review ${a}:\n${lines}\n\nPlease address the feedback and push a fix.`,
    );
  }
  return `<ci-monitor-event>${parts.join("\n\n")}</ci-monitor-event>`;
}

type DiffEntry = { notifiedFailures: Set<string> };

export class CodeAutoFixEngine {
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping = false;
  private sweepTick = 0;
  private readonly diffState = new Map<string, Map<string, DiffEntry>>();
  private readonly failureCounts = new Map<string, number>();
  private readonly deps: CodeAutoFixEngineDeps;

  constructor(deps: CodeAutoFixEngineDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
    this.firstTimer = setTimeout(() => {
      void this.sweep();
    }, FIRST_SWEEP_MS);
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.firstTimer) {
      clearTimeout(this.firstTimer);
      this.firstTimer = null;
    }
  }

  /** Official handleSessionEvent residual — kick when autoFixEnabled flips on. */
  onSessionUpdated(session: LocalSession | null | undefined): void {
    if (!session?.id) return;
    if (!session.autoFixEnabled) {
      this.diffState.delete(session.id);
      this.failureCounts.delete(session.id);
      return;
    }
    if (session.archived) return;
    if (!session.prs?.length) return;
    if (this.diffState.has(session.id)) return;
    this.diffState.set(session.id, new Map());
    if (!session.isRunning) {
      this.deps.log?.(`[CodeAutoFixEngine] auto-fix enabled; kicking ${session.id}`);
      void this.checkSession(session);
    }
  }

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const candidates = this.deps.store
        .getAll()
        .filter(
          (s) =>
            s.autoFixEnabled === true
            && !s.archived
            && ((s.prs?.length ?? 0) > 0),
        );
      const live = new Set(candidates.map((s) => s.id));
      for (const id of this.diffState.keys()) {
        if (!live.has(id)) this.diffState.delete(id);
      }
      for (const id of this.failureCounts.keys()) {
        if (!live.has(id)) this.failureCounts.delete(id);
      }
      const tick = this.sweepTick++;
      const due = candidates.filter((s) => {
        if (s.isRunning) return false;
        const fails = this.failureCounts.get(s.id) ?? 0;
        if (fails === 0) return true;
        const every = Math.min(2 ** fails, 16);
        return tick % every === 0;
      });
      for (let i = 0; i < due.length; i += BATCH) {
        const batch = due.slice(i, i + BATCH);
        await Promise.all(batch.map((s) => this.checkSession(s)));
      }
    } catch (error) {
      this.deps.log?.("[CodeAutoFixEngine] Sweep failed", error);
    } finally {
      this.sweeping = false;
    }
  }

  async checkSession(session: LocalSession): Promise<void> {
    const sessionId = session.id;
    const prs = session.prs ?? [];
    const open =
      prs.find((p) => !isTerminalPrState(p.state))
      ?? prs[0];
    if (!open?.number) return;
    const prNumber = open.number;
    const repo = open.repo;
    const cwd = session.worktreePath || session.originCwd || session.cwd;
    if (!cwd) return;

    try {
      const checksResult = await this.deps.getPrChecks(cwd, prNumber, repo);
      const ok = checksResult.success !== false && checksResult.ok !== false;
      if (!ok && checksResult.error) {
        this.failureCounts.set(sessionId, (this.failureCounts.get(sessionId) ?? 0) + 1);
        return;
      }
      this.failureCounts.delete(sessionId);

      const key = prKey(prNumber, repo);
      let map = this.diffState.get(sessionId);
      if (!map) {
        map = new Map();
        this.diffState.set(sessionId, map);
      }
      const prState = checksResult.prState?.toUpperCase();
      if (prState === "MERGED" || prState === "CLOSED") {
        map.delete(key);
        return;
      }

      const entry = map.get(key) ?? { notifiedFailures: new Set<string>() };
      const failed = failingCheckNames(checksResult.checks ?? []);
      const hasConflict = checksResult.mergeable === "CONFLICTING";
      const newFails = failed.filter((n) => !entry.notifiedFailures.has(n));
      const newConflict = hasConflict && !entry.notifiedFailures.has(MERGE_CONFLICT_KEY);

      const rawComments: CodeAutoFixComment[] = [];
      const fetchers: Array<
        | typeof this.deps.getPrReviewComments
        | typeof this.deps.getPrReviews
        | typeof this.deps.getPrIssueComments
      > = [
        this.deps.getPrReviewComments,
        this.deps.getPrReviews,
        this.deps.getPrIssueComments,
      ];
      for (const fetch of fetchers) {
        if (!fetch) continue;
        try {
          const result = await fetch(cwd, prNumber, repo);
          if (result.success !== false && Array.isArray(result.comments)) {
            rawComments.push(...result.comments);
          }
        } catch {
          /* soft — each comment source is independent */
        }
      }
      const seen = new Set(session.seenCommentIds?.[key] ?? []);
      const login = (await this.deps.getGhLogin?.()) ?? null;
      // Dedup across review lines / reviews / issue comments by id.
      const byId = new Map<string, CodeAutoFixComment>();
      for (const c of rawComments) {
        const id = String(c.dedupId ?? c.id ?? "");
        if (!id) continue;
        if (!byId.has(id)) byId.set(id, c);
      }
      const comments = filterAutoFixComments([...byId.values()], { login, seen });

      if (newFails.length === 0 && !newConflict && comments.length === 0) {
        const next = new Set(failed);
        if (hasConflict) next.add(MERGE_CONFLICT_KEY);
        entry.notifiedFailures = next;
        map.set(key, entry);
        return;
      }

      const message = buildAutoFixWakeMessage({
        failedChecks: newFails,
        hasMergeConflict: newConflict,
        comments,
        prNumber,
        repo,
      });
      this.deps.log?.(
        `[CodeAutoFixEngine] Waking ${sessionId}: ${newFails.length} failure(s)${newConflict ? " + conflict" : ""}${comments.length ? ` + ${comments.length} comment(s)` : ""}`,
      );
      await this.deps.sendMessage(sessionId, message);

      const next = new Set(failed);
      if (hasConflict) next.add(MERGE_CONFLICT_KEY);
      entry.notifiedFailures = next;
      map.set(key, entry);

      if (comments.length > 0) {
        const ids = comments
          .map((c) => String(c.dedupId ?? c.id ?? ""))
          .filter(Boolean);
        this.deps.store.addSeenCommentIds?.(sessionId, key, ids);
      }
    } catch (error) {
      this.deps.log?.(`[CodeAutoFixEngine] checkSession failed for ${sessionId}`, error);
    }
  }
}
