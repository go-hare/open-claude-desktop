import { describe, expect, it, vi } from "vitest";
import {
  buildAutoFixWakeMessage,
  CodeAutoFixEngine,
  filterAutoFixComments,
} from "./codeAutoFixEngine";
import type { LocalSession, LocalSessionStore } from "./localSessionStore";

function session(partial: Partial<LocalSession> & { id: string }): LocalSession {
  return {
    kind: "code",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    archived: false,
    isRunning: false,
    cwd: "/repo",
    title: "t",
    ...partial,
  };
}

describe("buildAutoFixWakeMessage (qlr residual)", () => {
  it("wraps CI failures in ci-monitor-event", () => {
    const msg = buildAutoFixWakeMessage({
      failedChecks: ["build"],
      hasMergeConflict: false,
      comments: [],
      prNumber: 7,
      repo: "o/r",
    });
    expect(msg).toContain("<ci-monitor-event>");
    expect(msg).toContain('"build"');
    expect(msg).toContain("gh pr checks 7 --repo o/r");
    expect(msg).toContain("</ci-monitor-event>");
  });

  it("includes merge conflict line", () => {
    const msg = buildAutoFixWakeMessage({
      failedChecks: [],
      hasMergeConflict: true,
      comments: [],
      prNumber: 1,
    });
    expect(msg).toContain("merge conflicts");
  });
});

describe("CodeAutoFixEngine", () => {
  it("no-ops when autoFixEnabled false", async () => {
    const sent: string[] = [];
    const getPrChecks = vi.fn(async () => ({
      ok: true,
      checks: [{ name: "ci", bucket: "fail" }],
    }));
    const store = {
      getAll: () => [
        session({
          id: "s1",
          autoFixEnabled: false,
          prs: [{ number: 1, state: "open" }],
        }),
      ],
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoFixEngine({
      store,
      getPrChecks,
      sendMessage: async (id, text) => {
        sent.push(`${id}:${text}`);
      },
    });
    await engine.sweep();
    expect(getPrChecks).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("wakes session on new CI failure when autofix on", async () => {
    const sent: string[] = [];
    const store = {
      getAll: () => [
        session({
          id: "s2",
          autoFixEnabled: true,
          prs: [{ number: 3, state: "open", repo: "a/b" }],
        }),
      ],
      addSeenCommentIds: vi.fn(),
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoFixEngine({
      store,
      getPrChecks: async () => ({
        ok: true,
        checks: [{ name: "test", bucket: "fail" }],
      }),
      sendMessage: async (id, text) => {
        sent.push(`${id}:${text.slice(0, 40)}`);
      },
    });
    await engine.sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("s2:");
    expect(sent[0]).toContain("<ci-monitor-event>");
    // Second sweep should not re-notify same failure.
    sent.length = 0;
    await engine.sweep();
    expect(sent).toEqual([]);
  });

  it("onSessionUpdated kicks when autofix enabled with prs", async () => {
    const check = vi.fn(async () => ({ ok: true, checks: [] }));
    const store = {
      getAll: () => [],
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoFixEngine({
      store,
      getPrChecks: check,
      sendMessage: async () => {},
    });
    engine.onSessionUpdated(
      session({
        id: "s3",
        autoFixEnabled: true,
        prs: [{ number: 9, state: "OPEN" }],
      }),
    );
    // allow microtask
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(check).toHaveBeenCalled();
  });

  it("wakes on Plr-eligible review + issue comments (full API residual)", async () => {
    const sent: string[] = [];
    const addSeen = vi.fn();
    const store = {
      getAll: () => [
        session({
          id: "s4",
          autoFixEnabled: true,
          prs: [{ number: 4, state: "open", repo: "o/r" }],
          seenCommentIds: {},
        }),
      ],
      addSeenCommentIds: addSeen,
      getSeenCommentIds: () => [],
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoFixEngine({
      store,
      getPrChecks: async () => ({ ok: true, checks: [] }),
      getPrReviews: async () => ({
        success: true,
        comments: [
          {
            id: 11,
            dedupId: "review:11",
            author: "alice",
            body: "please fix",
            state: "CHANGES_REQUESTED",
            authorAssociation: "MEMBER",
          },
        ],
      }),
      getPrIssueComments: async () => ({
        success: true,
        comments: [
          {
            id: 22,
            dedupId: "issue:22",
            author: "bob",
            body: "also this",
            authorAssociation: "OWNER",
          },
          {
            id: 23,
            dedupId: "issue:23",
            author: "botty",
            body: "automated",
            userType: "Bot",
            authorAssociation: "NONE",
          },
        ],
      }),
      getGhLogin: async () => "me",
      sendMessage: async (id, text) => {
        sent.push(`${id}:${text}`);
      },
    });
    await engine.sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("please fix");
    expect(sent[0]).toContain("also this");
    expect(sent[0]).not.toContain("automated");
    expect(addSeen).toHaveBeenCalled();
  });
});

describe("filterAutoFixComments (Plr residual)", () => {
  it("keeps OWNER/MEMBER/COLLABORATOR, drops Bot and empty", () => {
    const out = filterAutoFixComments(
      [
        { id: 1, author: "a", body: "x", authorAssociation: "OWNER" },
        { id: 2, author: "b", body: "y", authorAssociation: "CONTRIBUTOR" },
        { id: 3, author: "c", body: "z", userType: "Bot", authorAssociation: "MEMBER" },
        { id: 4, author: "d", body: "  ", authorAssociation: "MEMBER" },
        { id: 5, author: "me", body: "self", authorAssociation: "MEMBER" },
      ],
      { login: "me" },
    );
    expect(out.map((c) => c.id)).toEqual([1]);
  });
});
