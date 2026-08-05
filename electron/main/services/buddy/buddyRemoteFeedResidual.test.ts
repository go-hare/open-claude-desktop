import { describe, expect, it, vi } from "vitest";
import {
  BuddyRemoteFeedResidual,
  isBuddyRemoteFeedSession,
  parseBuddyRemoteFeedSessions,
} from "./buddyRemoteFeedResidual";

describe("buddyRemoteFeedResidual", () => {
  it("validates official session shape", () => {
    expect(
      isBuddyRemoteFeedSession({
        sessionId: "s1",
        isRunning: true,
        pendingToolPermissions: [
          { requestId: "r1", sessionId: "s1", toolName: "Bash" },
        ],
      }),
    ).toBe(true);
    expect(isBuddyRemoteFeedSession({ sessionId: "s1" })).toBe(false);
    expect(isBuddyRemoteFeedSession(null)).toBe(false);
  });

  it("sync stores sessions and does not invent ok bag", () => {
    const feed = new BuddyRemoteFeedResidual();
    const onSync = vi.fn();
    feed.setRemoteSyncListener(onSync);
    const sessions = [
      {
        sessionId: "bridge-1",
        isRunning: false,
        pendingToolPermissions: [] as [],
      },
    ];
    expect(feed.sync(sessions)).toBeUndefined();
    expect(feed.getAllSessions()).toEqual(sessions);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid sessions array", () => {
    expect(() => parseBuddyRemoteFeedSessions("nope")).toThrow(/sessions/);
    expect(() => parseBuddyRemoteFeedSessions([{ sessionId: 1 }])).toThrow(
      /sessions/,
    );
  });

  it("respondToToolPermission dispatches matching request", () => {
    const feed = new BuddyRemoteFeedResidual();
    const dispatch = vi.fn();
    feed.registerDispatcher({ dispatchPermissionDecision: dispatch });
    feed.sync([
      {
        sessionId: "sid",
        isRunning: true,
        pendingToolPermissions: [
          { requestId: "req-9", sessionId: "sid", toolName: "Read" },
        ],
      },
    ]);
    expect(feed.respondToToolPermission("req-9", "once")).toBe(true);
    expect(dispatch).toHaveBeenCalledWith("sid", "req-9", "once");
    expect(feed.respondToToolPermission("missing", "deny")).toBe(false);
  });
});
