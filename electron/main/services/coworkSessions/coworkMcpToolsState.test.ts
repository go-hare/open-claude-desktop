import { expect, it } from "vitest";
import {
  coerceCoworkEnabledMcpToolsArg,
  coerceCoworkRemoteMcpServersArg,
  coworkEnabledMcpToolsEqual,
  coworkRemoteMcpServersEqual,
  coworkRemoteMcpToolNames,
  diffCoworkEnabledMcpTools,
  hasCoworkMcpServerToolToggleDiff,
  isCoworkDispatchSessionType,
  isCoworkMcpServerToolsDisabled,
  resolveCoworkRemoteMcpServerKey,
  resolveCoworkReplaceEnabledMcpToolsChange,
  resolveCoworkReplaceRemoteMcpServersChange,
} from "./coworkMcpToolsState";

it("tv: agent and dispatch_child are dispatch session types", () => {
  expect(isCoworkDispatchSessionType("agent")).toBe(true);
  expect(isCoworkDispatchSessionType("dispatch_child")).toBe(true);
  expect(isCoworkDispatchSessionType("radar")).toBe(false);
  expect(isCoworkDispatchSessionType("scheduled")).toBe(false);
  expect(isCoworkDispatchSessionType(undefined)).toBe(false);
  expect(isCoworkDispatchSessionType(null)).toBe(false);
});

it("jC: local type or local name list uses name, else uuid", () => {
  expect(
    resolveCoworkRemoteMcpServerKey({
      name: "fs",
      type: "local",
      uuid: "u-1",
    }),
  ).toBe("fs");
  expect(
    resolveCoworkRemoteMcpServerKey(
      { name: "listed", uuid: "u-2" },
      ["listed"],
    ),
  ).toBe("listed");
  expect(
    resolveCoworkRemoteMcpServerKey({ name: "remote", uuid: "u-3" }),
  ).toBe("u-3");
});

it("jMA: all-false under prefix is disabled; missing/empty is not", () => {
  expect(isCoworkMcpServerToolsDisabled("srv", null)).toBe(false);
  expect(isCoworkMcpServerToolsDisabled("srv", {})).toBe(false);
  expect(
    isCoworkMcpServerToolsDisabled("srv", {
      "other:tool": false,
    }),
  ).toBe(false);
  expect(
    isCoworkMcpServerToolsDisabled("srv", {
      "srv:a": false,
      "srv:b": false,
    }),
  ).toBe(true);
  expect(
    isCoworkMcpServerToolsDisabled("srv", {
      "srv:a": false,
      "srv:b": true,
    }),
  ).toBe(false);
});

it("kJi: detects enabled flip under server prefix", () => {
  expect(
    hasCoworkMcpServerToolToggleDiff(
      "srv",
      { "srv:a": true },
      { "srv:a": true },
    ),
  ).toBe(false);
  expect(
    hasCoworkMcpServerToolToggleDiff(
      "srv",
      { "srv:a": true },
      { "srv:a": false },
    ),
  ).toBe(true);
  // missing previous key treated as on (value !== false)
  expect(
    hasCoworkMcpServerToolToggleDiff("srv", {}, { "srv:a": false }),
  ).toBe(true);
  expect(
    hasCoworkMcpServerToolToggleDiff(
      "srv",
      { "other:a": true },
      { "other:a": false },
    ),
  ).toBe(false);
});

it("d6e: create/delete from all-disabled toggle and inactive server", () => {
  const remote = {
    name: "remote-demo",
    tools: [{ name: "t1" }],
    uuid: "uuid-1",
  };

  // prev all-disabled → next enabled: create
  expect(
    diffCoworkEnabledMcpTools({
      localServerNames: ["demo"],
      previousEnabledMcpTools: { "local:demo:tool": false },
      newEnabledMcpTools: { "local:demo:tool": true },
      currentActiveServerKeys: new Set(["demo"]),
    }),
  ).toEqual({
    toCreate: { internal: [], local: ["demo"], remote: [] },
    toDelete: [],
  });

  // next all-disabled: delete
  expect(
    diffCoworkEnabledMcpTools({
      localServerNames: ["demo"],
      previousEnabledMcpTools: { "local:demo:tool": true },
      newEnabledMcpTools: { "local:demo:tool": false },
      currentActiveServerKeys: new Set(["demo"]),
    }),
  ).toEqual({
    toCreate: { internal: [], local: [], remote: [] },
    toDelete: [{ key: "demo", name: "demo" }],
  });

  // not disabled, not active → create
  expect(
    diffCoworkEnabledMcpTools({
      remoteServers: [remote],
      newEnabledMcpTools: {},
      currentActiveServerKeys: new Set(),
    }).toCreate.remote,
  ).toEqual([remote]);

  // not disabled, active, no toggle diff → noop
  expect(
    diffCoworkEnabledMcpTools({
      localServerNames: ["demo"],
      previousEnabledMcpTools: { "local:demo:tool": true },
      newEnabledMcpTools: { "local:demo:tool": true },
      currentActiveServerKeys: new Set(["demo"]),
    }),
  ).toEqual({
    toCreate: { internal: [], local: [], remote: [] },
    toDelete: [],
  });

  // internal uses local: prefix like official d6e
  expect(
    diffCoworkEnabledMcpTools({
      internalServerNames: ["cowork"],
      previousEnabledMcpTools: { "local:cowork:x": false },
      newEnabledMcpTools: { "local:cowork:x": true },
      currentActiveServerKeys: new Set(["cowork"]),
    }).toCreate.internal,
  ).toEqual(["cowork"]);
});

it("coerce accepts {tools} IPC payload and bare map; array → empty", () => {
  expect(
    coerceCoworkEnabledMcpToolsArg({
      tools: { "a:b": true, "a:c": false },
    }),
  ).toEqual({ "a:b": true, "a:c": false });
  expect(coerceCoworkEnabledMcpToolsArg({ "a:b": true })).toEqual({
    "a:b": true,
  });
  expect(coerceCoworkEnabledMcpToolsArg(["Read"])).toEqual({});
  expect(coerceCoworkEnabledMcpToolsArg(null)).toEqual({});
});

it("equality requires same keys and values", () => {
  expect(
    coworkEnabledMcpToolsEqual({ a: true }, { a: true }),
  ).toBe(true);
  expect(
    coworkEnabledMcpToolsEqual(null, {}),
  ).toBe(true);
  expect(
    coworkEnabledMcpToolsEqual({ a: true }, { a: false }),
  ).toBe(false);
  expect(
    coworkEnabledMcpToolsEqual({ a: true }, { a: true, b: true }),
  ).toBe(false);
});

it("resolve replace decision: skip_dispatch / noop / apply", () => {
  expect(
    resolveCoworkReplaceEnabledMcpToolsChange({
      currentEnabledMcpTools: { "s:t": true },
      requested: { tools: { "s:t": false } },
      sessionType: "agent",
    }),
  ).toEqual({
    action: "skip_dispatch",
    enabledMcpTools: { "s:t": true },
  });

  expect(
    resolveCoworkReplaceEnabledMcpToolsChange({
      currentEnabledMcpTools: { "s:t": true },
      requested: { tools: { "s:t": true } },
      sessionType: "radar",
    }),
  ).toEqual({
    action: "noop",
    enabledMcpTools: { "s:t": true },
  });

  expect(
    resolveCoworkReplaceEnabledMcpToolsChange({
      currentEnabledMcpTools: { "s:t": true },
      requested: { tools: { "s:t": false } },
      sessionType: "scheduled",
    }),
  ).toEqual({
    action: "apply",
    nextEnabledMcpTools: { "s:t": false },
    previousEnabledMcpTools: { "s:t": true },
  });
});

it("remote tool names sort; equality on jC keys + tool names", () => {
  expect(
    coworkRemoteMcpToolNames([{ name: "b" }, { name: "a" }, "c"]),
  ).toEqual(["a", "b", "c"]);

  const a = {
    name: "remote",
    tools: [{ name: "t1" }, { name: "t2" }],
    uuid: "u-1",
  };
  const sameToolsReordered = {
    name: "remote",
    tools: [{ name: "t2" }, { name: "t1" }],
    uuid: "u-1",
  };
  const differentTools = {
    name: "remote",
    tools: [{ name: "t1" }],
    uuid: "u-1",
  };
  const differentKey = {
    name: "remote",
    tools: [{ name: "t1" }, { name: "t2" }],
    uuid: "u-2",
  };

  expect(coworkRemoteMcpServersEqual([a], [sameToolsReordered])).toBe(true);
  expect(coworkRemoteMcpServersEqual([a], [differentTools])).toBe(false);
  expect(coworkRemoteMcpServersEqual([a], [differentKey])).toBe(false);
  expect(coworkRemoteMcpServersEqual([], [])).toBe(true);
  // local type uses name key
  expect(
    coworkRemoteMcpServersEqual(
      [{ name: "fs", tools: [{ name: "x" }], type: "local", uuid: "u-a" }],
      [{ name: "fs", tools: [{ name: "x" }], type: "local", uuid: "u-b" }],
    ),
  ).toBe(true);
});

it("coerce remote servers keeps uuid/name/tools; drops invalid", () => {
  expect(
    coerceCoworkRemoteMcpServersArg([
      {
        name: "ok",
        tools: [{ name: "t1" }, "t2", { name: "" }, 12],
        toolKeys: ["t1", "t2"],
        type: "remote",
        uuid: "u-1",
      },
      { name: "missing-uuid", tools: [], uuid: "" },
      null,
    ]),
  ).toEqual([
    {
      name: "ok",
      tools: [{ name: "t1" }, "t2"],
      type: "remote",
      uuid: "u-1",
    },
  ]);
  expect(coerceCoworkRemoteMcpServersArg(null)).toEqual([]);
});

it("resolve replaceRemote: noop on equal; apply assigns uuid/name/tools", () => {
  const prev = [
    {
      name: "remote",
      tools: [{ name: "t1" }],
      uuid: "u-1",
    },
  ];
  expect(
    resolveCoworkReplaceRemoteMcpServersChange({
      currentEnabledMcpTools: { "u-1:t1": true },
      currentRemoteServers: prev,
      requested: [
        {
          name: "remote",
          tools: [{ name: "t1" }],
          toolKeys: ["t1"],
          uuid: "u-1",
        },
      ],
    }),
  ).toEqual({
    action: "noop",
    enabledMcpTools: { "u-1:t1": true },
  });

  const applied = resolveCoworkReplaceRemoteMcpServersChange({
    currentEnabledMcpTools: { "u-1:t1": true },
    currentRemoteServers: prev,
    requested: [
      {
        name: "remote",
        tools: [{ name: "t1" }, { name: "t2" }],
        toolKeys: ["t1", "t2"],
        uuid: "u-1",
      },
    ],
  });
  expect(applied).toEqual({
    action: "apply",
    enabledMcpTools: { "u-1:t1": true },
    nextRemoteServers: [
      {
        name: "remote",
        tools: [{ name: "t1" }, { name: "t2" }],
        uuid: "u-1",
      },
    ],
    previousRemoteServers: prev,
  });
});
