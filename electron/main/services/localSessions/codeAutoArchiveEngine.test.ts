import { describe, expect, it, vi } from "vitest";
import {
  CodeAutoArchiveEngine,
  areAllPrsTerminal,
  isTerminalPrState,
} from "./codeAutoArchiveEngine";
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
    ...partial,
  };
}

describe("CodeAutoArchiveEngine session.prs residual", () => {
  it("archives immediately when session.prs all terminal (no network)", async () => {
    const archived: string[] = [];
    const store = {
      getAll: () => [
        session({
          id: "s1",
          prs: [{ number: 7, state: "merged" }],
        }),
      ],
    } as unknown as LocalSessionStore;
    const lookupPrs = vi.fn(async () => null);
    const engine = new CodeAutoArchiveEngine({
      store,
      isEnabled: () => true,
      lookupPrs,
      archiveSession: async (id) => {
        archived.push(id);
        return true;
      },
      now: () => 1_000_000,
    });
    await engine.sweep();
    expect(archived).toEqual(["s1"]);
    expect(lookupPrs).not.toHaveBeenCalled();
  });

  it("writes prs from lookup then archives when terminal", async () => {
    const written: unknown[] = [];
    const archived: string[] = [];
    const store = {
      getAll: () => [session({ id: "s2" })],
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoArchiveEngine({
      store,
      isEnabled: () => true,
      lookupPrs: async () => [{ number: 3, state: "closed", merged: true }],
      writePrs: (id, prs) => {
        written.push({ id, prs });
      },
      archiveSession: async (id) => {
        archived.push(id);
        return true;
      },
      // Force TTL eligible (last check never set → 0).
      now: () => PR_NOW,
    });
    await engine.sweep();
    expect(written).toEqual([
      { id: "s2", prs: [{ number: 3, state: "closed", merged: true }] },
    ]);
    expect(archived).toEqual(["s2"]);
  });

  it("no-ops when pref disabled", async () => {
    const archived: string[] = [];
    const store = {
      getAll: () => [
        session({ id: "s3", prs: [{ number: 1, state: "merged" }] }),
      ],
    } as unknown as LocalSessionStore;
    const engine = new CodeAutoArchiveEngine({
      store,
      isEnabled: () => false,
      lookupPrs: async () => null,
      archiveSession: async (id) => {
        archived.push(id);
        return true;
      },
    });
    await engine.sweep();
    expect(archived).toEqual([]);
  });
});

const PR_NOW = 10_000_000;

describe("helpers", () => {
  it("isTerminalPrState / areAllPrsTerminal", () => {
    expect(isTerminalPrState("MERGED")).toBe(true);
    expect(areAllPrsTerminal([{ state: "open" }])).toBe(false);
    expect(areAllPrsTerminal([{ merged: true }])).toBe(true);
  });
});
