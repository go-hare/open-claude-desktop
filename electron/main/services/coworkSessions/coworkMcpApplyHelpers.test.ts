import { describe, expect, it } from "vitest";
import {
  isCoworkSessionBusyForMcpApply,
  mergeCoworkActiveMcpServersAfterRemoteReplace,
  removeCoworkActiveMcpServerKeys,
  resolveCoworkApplyMcpServersIfIdle,
  resolveCoworkSetMcpServersChange,
  shouldFlushCoworkDeferredMcpServers,
  sortCoworkMcpServersForSet,
} from "./coworkMcpApplyHelpers";

describe("isCoworkSessionBusyForMcpApply (Wl)", () => {
  it("matches official Wl truth table", () => {
    expect(isCoworkSessionBusyForMcpApply("idle")).toBe(false);
    expect(isCoworkSessionBusyForMcpApply("archived")).toBe(false);
    expect(isCoworkSessionBusyForMcpApply("running")).toBe(true);
    expect(isCoworkSessionBusyForMcpApply("stopping")).toBe(true);
    expect(isCoworkSessionBusyForMcpApply("initializing")).toBe(true);
    expect(isCoworkSessionBusyForMcpApply(undefined)).toBe(true);
    expect(isCoworkSessionBusyForMcpApply(null)).toBe(true);
  });
});

describe("sortCoworkMcpServersForSet (rwA)", () => {
  it("identity when sortKeys false", () => {
    const servers = { b: 1, a: 2 };
    expect(sortCoworkMcpServersForSet(servers, false)).toBe(servers);
  });

  it("sorts keys when sortKeys true", () => {
    const sorted = sortCoworkMcpServersForSet({ z: 1, a: 2, m: 3 }, true);
    expect(Object.keys(sorted)).toEqual(["a", "m", "z"]);
  });
});

describe("resolveCoworkApplyMcpServersIfIdle", () => {
  it("defers when busy even with query", () => {
    expect(
      resolveCoworkApplyMcpServersIfIdle({
        hasQuery: true,
        lifecycleState: "running",
        servers: { a: 1 },
      }),
    ).toEqual({ action: "defer", lifecycleState: "running" });
  });

  it("skips without dirty when no query and idle", () => {
    expect(
      resolveCoworkApplyMcpServersIfIdle({
        hasQuery: false,
        lifecycleState: "idle",
        servers: { a: 1 },
      }),
    ).toEqual({ action: "skip_no_query" });
  });

  it("defers when no query but busy", () => {
    expect(
      resolveCoworkApplyMcpServersIfIdle({
        hasQuery: false,
        lifecycleState: "running",
        servers: { a: 1 },
      }),
    ).toEqual({ action: "defer", lifecycleState: "running" });
  });

  it("applies when query + idle", () => {
    expect(
      resolveCoworkApplyMcpServersIfIdle({
        hasQuery: true,
        lifecycleState: "idle",
        servers: { b: 1, a: 2 },
        sortKeys: true,
      }),
    ).toEqual({
      action: "apply",
      servers: { a: 2, b: 1 },
    });
  });
});

describe("mergeCoworkActiveMcpServersAfterRemoteReplace", () => {
  it("drops removed remote keys and assigns created", () => {
    const merged = mergeCoworkActiveMcpServersAfterRemoteReplace({
      activeMcpServers: {
        keepLocal: { type: "sdk" },
        "uuid-old": { type: "http" },
        "uuid-stay": { type: "http" },
      },
      previousRemote: [
        { uuid: "uuid-old", name: "Old", tools: [] },
        { uuid: "uuid-stay", name: "Stay", tools: [] },
      ],
      nextRemoteKeys: new Set(["uuid-stay", "uuid-new"]),
      createdRemoteServers: {
        "uuid-new": { type: "http" },
        "uuid-stay": { type: "http", refreshed: true },
      },
    });
    expect(merged).toEqual({
      keepLocal: { type: "sdk" },
      "uuid-stay": { type: "http", refreshed: true },
      "uuid-new": { type: "http" },
    });
    expect(merged).not.toHaveProperty("uuid-old");
  });
});

describe("resolveCoworkSetMcpServersChange", () => {
  it("skips dispatch session types", () => {
    const decision = resolveCoworkSetMcpServersChange({
      currentEnabledMcpTools: { "a:tool": true },
      requested: [
        {
          enabled: false,
          name: "x",
          toolKeys: ["a:tool"],
          uuid: "u1",
        },
      ],
      sessionType: "agent",
    });
    expect(decision).toEqual({
      action: "skip_dispatch",
      enabledMcpTools: { "a:tool": true },
    });
  });

  it("disables remote + toolKeys and queues creates", () => {
    const decision = resolveCoworkSetMcpServersChange({
      currentEnabledMcpTools: { "srv:tool": true },
      currentRemoteServers: [
        { uuid: "u1", name: "Srv", tools: [{ name: "tool" }] },
      ],
      requested: [
        {
          enabled: false,
          name: "Srv",
          toolKeys: ["srv:tool"],
          type: "http",
          uuid: "u1",
        },
        {
          enabled: true,
          name: "New",
          tools: [{ name: "t" }],
          type: "http",
          uuid: "u2",
          toolKeys: ["new:t"],
        },
      ],
    });
    expect(decision.action).toBe("apply");
    if (decision.action !== "apply") return;
    expect(decision.removedActiveKeys).toEqual(["u1"]);
    expect(decision.enabledMcpTools).toEqual({
      "srv:tool": false,
      "new:t": true,
    });
    expect(decision.remoteMcpServersConfig.map((r) => r.uuid)).toEqual([
      "u2",
    ]);
    expect(decision.toCreate.map((c) => c.uuid)).toEqual(["u2"]);
  });
});

describe("removeCoworkActiveMcpServerKeys + shouldFlush", () => {
  it("removes keys", () => {
    expect(
      removeCoworkActiveMcpServerKeys({ a: 1, b: 2 }, ["a"]),
    ).toEqual({ b: 2 });
  });

  it("flush only when dirty + active object", () => {
    expect(
      shouldFlushCoworkDeferredMcpServers({
        mcpServersDirty: true,
        activeMcpServers: { a: 1 },
      }),
    ).toBe(true);
    expect(
      shouldFlushCoworkDeferredMcpServers({
        mcpServersDirty: true,
        activeMcpServers: null,
      }),
    ).toBe(false);
    expect(
      shouldFlushCoworkDeferredMcpServers({
        mcpServersDirty: false,
        activeMcpServers: { a: 1 },
      }),
    ).toBe(false);
  });
});
