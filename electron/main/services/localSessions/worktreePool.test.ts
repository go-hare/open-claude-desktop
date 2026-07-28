import { describe, expect, it } from "vitest";
import {
  classifyWorktree,
  planReap,
  rankAcquireCandidates,
  WorktreePool,
  type WorktreePoolEntry,
  type WorktreeRegistryStore,
} from "./worktreePool";

function memRegistry(seed: WorktreePoolEntry[] = []): WorktreeRegistryStore {
  let entries = [...seed];
  return {
    load: () => [...entries],
    save: (next) => {
      entries = [...next];
    },
  };
}

describe("classifyWorktree (dat residual)", () => {
  const now = 1_000_000;
  it("unleased always eligible", () => {
    expect(
      classifyWorktree({ leasedBy: null, createdAt: now - 1 }, null, 300_000, now),
    ).toEqual({ eligible: true, lastActivityAt: 0, unleased: true });
  });
  it("running / pinned / remote not eligible", () => {
    expect(
      classifyWorktree(
        { leasedBy: "s1", createdAt: 0 },
        { isRunning: true, lastActivityAt: 0 },
        300_000,
        now,
      ),
    ).toMatchObject({ eligible: false, reason: "running" });
    expect(
      classifyWorktree(
        { leasedBy: "s1", createdAt: 0 },
        { worktreePinned: true, lastActivityAt: 0 },
        300_000,
        now,
      ),
    ).toMatchObject({ eligible: false, reason: "pinned" });
    expect(
      classifyWorktree(
        { leasedBy: "s1", createdAt: 0 },
        { isRemote: true, lastActivityAt: 0 },
        300_000,
        now,
      ),
    ).toMatchObject({ eligible: false, reason: "remote" });
  });
  it("archived eligible", () => {
    expect(
      classifyWorktree(
        { leasedBy: "s1", createdAt: 0 },
        { isArchived: true, lastActivityAt: 50 },
        300_000,
        now,
      ),
    ).toEqual({ eligible: true, lastActivityAt: 50, unleased: false });
  });
});

describe("rankAcquireCandidates (hat residual)", () => {
  it("prefers pooledAt desc, then unleased, then older activity", () => {
    const ranked = rankAcquireCandidates([
      { pooledAt: undefined, unleased: false, lastActivityAt: 10, id: "a" },
      { pooledAt: 200, unleased: false, lastActivityAt: 5, id: "b" },
      { pooledAt: 100, unleased: true, lastActivityAt: 1, id: "c" },
      { pooledAt: undefined, unleased: true, lastActivityAt: 2, id: "d" },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("planReap (fat residual)", () => {
  it("maxWarm keeps N newest per baseRepo", () => {
    const reaped = planReap(
      [
        { baseRepo: "/r", name: "a", lastActivityAt: 30 },
        { baseRepo: "/r", name: "b", lastActivityAt: 20 },
        { baseRepo: "/r", name: "c", lastActivityAt: 10 },
      ],
      { maxWarm: 1, reapAfterMs: 0, now: 100 },
    );
    expect(reaped.map((e) => e.name).sort()).toEqual(["b", "c"]);
  });
});

describe("WorktreePool tryAcquire / release", () => {
  it("reuses clean unleased entry for same baseRepo", async () => {
    const entry: WorktreePoolEntry = {
      name: "wt1",
      path: "/tmp/wt1-does-not-need-exist-for-dirty-skip",
      baseRepo: "/repo",
      leasedBy: null,
      pooledAt: 50,
      createdAt: 1,
    };
    // Use dirExists true + isClean true stubs
    const attached: string[] = [];
    const pool = new WorktreePool({
      registry: memRegistry([entry]),
      isEnabled: () => true,
      prefs: () => ({ maxWarm: 3, reapAfterMs: 86_400_000 }),
      getSessionPoolState: () => null,
      hasLoadedSessions: () => true,
      detachWorktreeFromSession: () => {},
      attachWorktreeToSession: (sid, e) => {
        attached.push(`${sid}:${e.name}`);
      },
      dirExists: async () => true,
      hasKeepSentinel: async () => false,
      isWorktreeClean: async () => true,
      now: () => 1000,
    });
    const got = await pool.tryAcquire({ baseRepo: "/repo", sessionId: "s9" });
    expect(got?.name).toBe("wt1");
    expect(attached).toEqual(["s9:wt1"]);
    expect(pool.listAll()[0]?.leasedBy).toBe("s9");
  });

  it("no-ops tryAcquire when disabled", async () => {
    const pool = new WorktreePool({
      registry: memRegistry([
        {
          name: "wt",
          path: "/p",
          baseRepo: "/r",
          leasedBy: null,
          createdAt: 1,
          pooledAt: 1,
        },
      ]),
      isEnabled: () => false,
      prefs: () => ({ maxWarm: 3, reapAfterMs: 1 }),
      getSessionPoolState: () => null,
      hasLoadedSessions: () => true,
      detachWorktreeFromSession: () => {},
      attachWorktreeToSession: () => {},
      dirExists: async () => true,
      isWorktreeClean: async () => true,
    });
    expect(await pool.tryAcquire({ baseRepo: "/r", sessionId: "s" })).toBeNull();
  });
});
