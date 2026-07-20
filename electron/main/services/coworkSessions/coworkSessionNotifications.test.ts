import { expect, it } from "vitest";
import {
  accumulateCoworkCachedTotalTurnsOnStop,
  appendCoworkCuWindowHint,
  appendCoworkPreUserMessageHints,
  appendCoworkWidgetContextHint,
  applyCoworkSessionSpaceIdUpdate,
  applyCoworkSessionTitleUpdate,
  buildCoworkSpaceContextReminder,
  clearCoworkSessionEphemeralsOnLeavingRunning,
  consumeCoworkPendingSystemReminder,
  COWORK_MODEL_SWITCH_TOOLSEARCH_CU_SUFFIX,
  COWORK_READ_WIDGET_CONTEXT_TOOL,
  coworkFoldersNoLongerAvailableMessage,
  coworkHostLoopFolderAccessMessage,
  coworkHostLoopLocalFolderAccessMessage,
  coworkHostLoopNetworkDriveAccessMessage,
  coworkModelSwitchedMessage,
  coworkQueuedMountNextResumeMessage,
  coworkSessionSpaceChangedMessage,
  coworkWorktreeDeletedSystemReminder,
  coworkWorktreeRecycledSystemReminder,
  drainCoworkPendingNotifications,
  invalidateCoworkBuiltPromptAndTools,
  isCoworkNativeToolSearchModel,
  mergeCoworkPendingSystemReminder,
  notifyCoworkHostLoopFolderAccess,
  notifyCoworkModelSwitched,
  notifyCoworkQueuedMountNextResume,
  queueCoworkSessionNotification,
  setCoworkPendingSystemReminder,
  stripCoworkHintAngleBrackets,
} from "./coworkSessionNotifications";
import { createUserMessage } from "./coworkSessionState";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

function session(
  overrides: Partial<CoworkSessionRuntimeState> = {},
): CoworkSessionRuntimeState {
  return {
    createdAt: 1,
    cwd: "/sessions/test",
    fsDetectedFiles: new Map(),
    inputStream: null,
    isFirstTurn: false,
    lastActivityAt: 1,
    lifecycleState: "idle",
    messageBuffer: [],
    pendingNotifications: [],
    processName: "test",
    query: null,
    resolvedFolders: [],
    sessionId: "session-1",
    vmProcessName: "test",
    ...overrides,
  };
}

it("uses official host-loop access notification strings (U+2014)", () => {
  expect(coworkHostLoopLocalFolderAccessMessage("/proj")).toBe(
    "You now have access to /proj. Read/Bash work there directly.",
  );
  const net = coworkHostLoopNetworkDriveAccessMessage("Z:/share");
  expect(net).toContain("\u2014");
  expect(net).toBe(
    "You now have access to Z:/share. It's on a network drive \u2014 Read/Write/Edit/Grep/Glob work there; bash cannot reach it.",
  );
  expect(coworkHostLoopFolderAccessMessage("/p", false)).toBe(
    coworkHostLoopLocalFolderAccessMessage("/p"),
  );
  expect(coworkHostLoopFolderAccessMessage("Z:/s", true)).toBe(
    coworkHostLoopNetworkDriveAccessMessage("Z:/s"),
  );
});

it("queues notifications with <> strip and last-dedupe", () => {
  const s = session();
  expect(queueCoworkSessionNotification(s, "hello <world>")).toBe(true);
  expect(s.pendingNotifications).toEqual(["hello world"]);
  expect(queueCoworkSessionNotification(s, "hello <world>")).toBe(false);
  expect(s.pendingNotifications).toEqual(["hello world"]);
  expect(queueCoworkSessionNotification(s, "next")).toBe(true);
  expect(s.pendingNotifications).toEqual(["hello world", "next"]);
});

it("drains pending into system-reminder (official ft path)", () => {
  const s = session({ pendingNotifications: ["a", "b"] });
  expect(drainCoworkPendingNotifications(s, "user msg")).toBe(
    "user msg\n\n<system-reminder>\na\n\nb\n</system-reminder>",
  );
  expect(s.pendingNotifications).toEqual([]);
  expect(drainCoworkPendingNotifications(s, "again")).toBe("again");
});

it("clears pending without wrapping when preferSessionNotifications false", () => {
  const s = session({ pendingNotifications: ["a"] });
  expect(
    drainCoworkPendingNotifications(s, "user", {
      preferSessionNotifications: false,
    }),
  ).toBe("user");
  expect(s.pendingNotifications).toEqual([]);
});

it("invalidates official built* fields on DANGEROUS path", () => {
  const s = session({
    builtGen: 2,
    builtSystemPrompt: "old",
    builtTools: ["x"],
    builtAllowedTools: ["y"],
    builtLocalMcpServers: { a: 1 },
  });
  invalidateCoworkBuiltPromptAndTools(s);
  expect(s.builtGen).toBe(3);
  expect(s.builtSystemPrompt).toBeUndefined();
  expect(s.builtTools).toBeUndefined();
  expect(s.builtAllowedTools).toBeUndefined();
  expect(s.builtLocalMcpServers).toBeUndefined();
});

it("notify host-loop folder access queues or invalidates per prefer flag", () => {
  const queued = session();
  expect(
    notifyCoworkHostLoopFolderAccess(queued, "/proj", false, {
      preferSessionNotifications: true,
    }),
  ).toBe("queued");
  expect(queued.pendingNotifications).toEqual([
    "You now have access to /proj. Read/Bash work there directly.",
  ]);

  const inv = session({ builtGen: 0, builtSystemPrompt: "p" });
  expect(
    notifyCoworkHostLoopFolderAccess(inv, "/proj", false, {
      preferSessionNotifications: false,
    }),
  ).toBe("invalidated");
  expect(inv.pendingNotifications).toEqual([]);
  expect(inv.builtGen).toBe(1);
  expect(inv.builtSystemPrompt).toBeUndefined();
});

it("formats official deleted-from-disk folder notify strings", () => {
  expect(coworkFoldersNoLongerAvailableMessage(["/a"])).toBe(
    "The folder /a is no longer available (deleted from disk).",
  );
  expect(coworkFoldersNoLongerAvailableMessage(["/a", "/b"])).toBe(
    "The folders /a, /b are no longer available (deleted from disk).",
  );
  expect(coworkFoldersNoLongerAvailableMessage([])).toBe("");
});

it("formats official space enter/leave notify strings", () => {
  expect(coworkSessionSpaceChangedMessage("Work")).toBe(
    'This session is now in the "Work" Space.',
  );
  expect(coworkSessionSpaceChangedMessage(null)).toBe(
    "This session is no longer in a Space.",
  );
  expect(coworkSessionSpaceChangedMessage(undefined)).toBe(
    "This session is no longer in a Space.",
  );
});

it("applies spaceId update with refuse-auto and queue notify", () => {
  const s = session({ spaceId: "old", spaceIdSetBy: "user" });
  expect(
    applyCoworkSessionSpaceIdUpdate(
      s,
      { spaceId: "new", spaceIdSetBy: "auto" },
      { getSpaceName: () => "New" },
    ),
  ).toBe("refused");
  expect(s.spaceId).toBe("old");
  expect(s.pendingNotifications).toEqual([]);

  expect(
    applyCoworkSessionSpaceIdUpdate(
      s,
      { spaceId: "new", spaceIdSetBy: "user" },
      { getSpaceName: (id) => (id === "new" ? "New Space" : null) },
    ),
  ).toBe("applied");
  expect(s.spaceId).toBe("new");
  expect(s.spaceIdSetBy).toBe("user");
  expect(s.pendingNotifications).toEqual([
    'This session is now in the "New Space" Space.',
  ]);

  s.pendingSystemReminder = "<system-reminder>\nx\n</system-reminder>";
  expect(
    applyCoworkSessionSpaceIdUpdate(s, { spaceId: "" }, {}),
  ).toBe("applied");
  expect(s.spaceId).toBeUndefined();
  expect(s.spaceIdSetBy).toBeUndefined();
  expect(s.pendingSystemReminder).toBeUndefined();
  expect(s.pendingNotifications.at(-1)).toBe(
    "This session is no longer in a Space.",
  );
});

it("merges pendingSystemReminder with official $MA order", () => {
  expect(mergeCoworkPendingSystemReminder("hello", "<system-reminder>\nx\n</system-reminder>")).toBe(
    "<system-reminder>\nx\n</system-reminder>\n\nhello",
  );
  expect(mergeCoworkPendingSystemReminder("/compact", "<system-reminder>\nx\n</system-reminder>")).toBe(
    "/compact <system-reminder>\nx\n</system-reminder>",
  );
  // trimStart before slash check (official e.trimStart().startsWith("/"))
  expect(mergeCoworkPendingSystemReminder("  /help", "R")).toBe("  /help R");
});

it("consumes pendingSystemReminder once then drains notifications", () => {
  const s = session({
    pendingSystemReminder: "<system-reminder>\nworktree gone\n</system-reminder>",
    pendingNotifications: ["You now have access to /proj. Read/Bash work there directly."],
  });
  expect(consumeCoworkPendingSystemReminder(s, "next")).toBe(
    "<system-reminder>\nworktree gone\n</system-reminder>\n\nnext",
  );
  expect(s.pendingSystemReminder).toBeUndefined();
  // second consume is no-op
  expect(consumeCoworkPendingSystemReminder(s, "again")).toBe("again");

  const full = session({
    pendingSystemReminder: "<system-reminder>\nA\n</system-reminder>",
    pendingNotifications: ["B"],
  });
  const msg = createUserMessage(full, "user", "uuid-1");
  expect(msg.message.content).toBe(
    "<system-reminder>\nA\n</system-reminder>\n\nuser\n\n<system-reminder>\nB\n</system-reminder>",
  );
  expect(full.pendingSystemReminder).toBeUndefined();
  expect(full.pendingNotifications).toEqual([]);
});

it("matches official rG ToolSearch model gate", () => {
  expect(isCoworkNativeToolSearchModel(undefined)).toBe(false);
  expect(isCoworkNativeToolSearchModel("")).toBe(false);
  expect(isCoworkNativeToolSearchModel("claude-opus-4-6")).toBe(true);
  expect(isCoworkNativeToolSearchModel("claude-sonnet-4-6")).toBe(false);
  expect(isCoworkNativeToolSearchModel("claude-sonnet-4-6[1m]")).toBe(true);
  expect(isCoworkNativeToolSearchModel("claude-sonnet-4-5")).toBe(false);
});

it("formats official Model switched notify + CU ToolSearch suffix (U+2014)", () => {
  expect(coworkModelSwitchedMessage("claude-sonnet-4-5")).toBe(
    "Model switched to claude-sonnet-4-5.",
  );
  expect(
    coworkModelSwitchedMessage("claude-sonnet-4-5", {
      previousModel: "claude-opus-4-6",
      nextModel: "claude-sonnet-4-5",
    }),
  ).toBe(
    `Model switched to claude-sonnet-4-5.${COWORK_MODEL_SWITCH_TOOLSEARCH_CU_SUFFIX}`,
  );
  expect(COWORK_MODEL_SWITCH_TOOLSEARCH_CU_SUFFIX).toContain("\u2014");
  // staying on rG model — no suffix
  expect(
    coworkModelSwitchedMessage("claude-opus-4-6", {
      previousModel: "claude-opus-4-6",
      nextModel: "claude-opus-4-6",
    }),
  ).toBe("Model switched to claude-opus-4-6.");
  // entering rG from non-rG — no suffix
  expect(
    coworkModelSwitchedMessage("claude-opus-4-6", {
      previousModel: "claude-sonnet-4-5",
      nextModel: "claude-opus-4-6",
    }),
  ).toBe("Model switched to claude-opus-4-6.");
});

it("notify model switched queues or invalidates per prefer flag", () => {
  const queued = session({ model: "claude-opus-4-6" });
  expect(
    notifyCoworkModelSwitched(queued, "claude-sonnet-4-5", {
      previousModel: "claude-opus-4-6",
      nextModel: "claude-sonnet-4-5",
      preferSessionNotifications: true,
    }),
  ).toBe("queued");
  expect(queued.pendingNotifications[0]).toContain("Model switched to claude-sonnet-4-5.");
  expect(queued.pendingNotifications[0]).toContain("ToolSearch");

  const inv = session({ builtGen: 0, builtSystemPrompt: "p" });
  expect(
    notifyCoworkModelSwitched(inv, "claude-sonnet-4-5", {
      previousModel: "x",
      preferSessionNotifications: false,
    }),
  ).toBe("invalidated");
  expect(inv.pendingNotifications).toEqual([]);
  expect(inv.builtGen).toBe(1);
  expect(inv.builtSystemPrompt).toBeUndefined();
});

it("applies title update with refuse-auto when user renamed", () => {
  const s = session({ title: "User Title", titleSource: "user" });
  expect(
    applyCoworkSessionTitleUpdate(s, {
      title: "Auto Title",
      titleSource: "auto",
    }),
  ).toBe("refused");
  expect(s.title).toBe("User Title");
  expect(s.titleSource).toBe("user");

  expect(
    applyCoworkSessionTitleUpdate(s, {
      title: "Manual Rename",
      titleSource: "user",
    }),
  ).toBe("applied");
  expect(s.title).toBe("Manual Rename");
  expect(s.titleSource).toBe("user");

  const auto = session({ title: "Old", titleSource: "auto" });
  expect(
    applyCoworkSessionTitleUpdate(auto, {
      title: "Generated",
      titleSource: "auto",
    }),
  ).toBe("applied");
  expect(auto.title).toBe("Generated");
  expect(auto.titleSource).toBe("auto");

  // default source is user when omitted
  const bare = session();
  expect(applyCoworkSessionTitleUpdate(bare, { title: "T" })).toBe("applied");
  expect(bare.titleSource).toBe("user");
});

it("appends official widget_context_hint with lRA + unique tool_names", () => {
  expect(COWORK_READ_WIDGET_CONTEXT_TOOL).toBe(
    "mcp__cowork__read_widget_context",
  );
  expect(stripCoworkHintAngleBrackets("a<b>c")).toBe("abc");
  const empty = session();
  expect(appendCoworkWidgetContextHint(empty, "hi")).toBe("hi");

  const s = session({
    widgetToolStates: [
      { content: [], tool_name: "widget_a" },
      { content: [], tool_name: "widget_<b>" },
      { content: [], tool_name: "widget_a" },
    ],
  });
  const out = appendCoworkWidgetContextHint(s, "hi");
  expect(out).toContain("hi\n\n<widget_context_hint>");
  expect(out).toContain("Interactive widgets in this conversation: widget_a, widget_b.");
  expect(out).toContain(
    `load ${COWORK_READ_WIDGET_CONTEXT_TOOL} (via ToolSearch if deferred)`,
  );
  // does not clear widgetToolStates
  expect(s.widgetToolStates).toHaveLength(3);
});

it("appends official cu_window_hints with U+2014 and clears mentions", () => {
  const empty = session();
  expect(appendCoworkCuWindowHint(empty, "hi")).toBe("hi");

  const s = session({
    cuMentionedWindows: [
      { title: "Slack <app>", bundleId: "com.tinyspeck.<slack>" },
      { title: "Notes", bundleId: "com.apple.Notes" },
    ],
  });
  const out = appendCoworkCuWindowHint(s, "hi");
  expect(out).toContain("hi\n\n<cu_window_hints>");
  expect(out).toContain(
    'window "Slack app" (already open; pass com.tinyspeck.slack to request_access)',
  );
  expect(out).toContain(
    'window "Notes" (already open; pass com.apple.Notes to request_access)',
  );
  expect(out).toContain("\u2014");
  expect(out).toContain(
    "Take a screenshot to find it \u2014 do not open_application for it.",
  );
  expect(s.cuMentionedWindows).toBeUndefined();
});

it("applies official hint order: CU then widget, before $MA/drain", () => {
  const s = session({
    cuMentionedWindows: [{ title: "Finder", bundleId: "com.apple.finder" }],
    widgetToolStates: [{ content: [], tool_name: "w1" }],
    pendingSystemReminder: "<system-reminder>\nR\n</system-reminder>",
    pendingNotifications: ["N"],
  });
  const hinted = appendCoworkPreUserMessageHints(s, "user");
  expect(hinted).toContain("<cu_window_hints>");
  expect(hinted).toContain("<widget_context_hint>");
  // CU block appears before widget block
  expect(hinted.indexOf("<cu_window_hints>")).toBeLessThan(
    hinted.indexOf("<widget_context_hint>"),
  );
  expect(s.cuMentionedWindows).toBeUndefined();

  // full createUserMessage pipeline
  const full = session({
    cuMentionedWindows: [{ title: "Finder", bundleId: "com.apple.finder" }],
    widgetToolStates: [{ content: [], tool_name: "w1" }],
    pendingSystemReminder: "<system-reminder>\nR\n</system-reminder>",
    pendingNotifications: ["N"],
  });
  const msg = createUserMessage(full, "user", "uuid-hints");
  const text = msg.message.content;
  expect(typeof text).toBe("string");
  const body = String(text);
  // Official: consume prepends R, then hints body, then drain appends N.
  expect(body.indexOf("<system-reminder>\nR\n</system-reminder>")).toBeLessThan(
    body.indexOf("user"),
  );
  expect(body.indexOf("user")).toBeLessThan(body.indexOf("<cu_window_hints>"));
  expect(body.indexOf("<cu_window_hints>")).toBeLessThan(
    body.indexOf("<widget_context_hint>"),
  );
  expect(body.indexOf("<widget_context_hint>")).toBeLessThan(
    body.indexOf("<system-reminder>\nN\n</system-reminder>"),
  );
  expect(full.cuMentionedWindows).toBeUndefined();
  expect(full.pendingSystemReminder).toBeUndefined();
  expect(full.pendingNotifications).toEqual([]);
});

it("clearCoworkSessionEphemeralsOnLeavingRunning wipes product CU ephemerals", () => {
  const s = session({
    _turnInterruptRequested: true,
    cuMentionedWindows: [{ title: "Notes", bundleId: "com.apple.Notes" }],
    widgetToolStates: [{ content: [], tool_name: "w1" }],
    pendingNotifications: ["keep"],
  });
  clearCoworkSessionEphemeralsOnLeavingRunning(s);
  expect(s.cuMentionedWindows).toBeUndefined();
  expect(s.widgetToolStates).toBeUndefined();
  // Official idle: clear _turnInterruptRequested
  expect(s._turnInterruptRequested).toBeUndefined();
  // Does not invent wipe of notification queue / other fields.
  expect(s.pendingNotifications).toEqual(["keep"]);
});

it("accumulateCoworkCachedTotalTurnsOnStop counts user buffer and clears it", () => {
  const s = session({
    cachedTotalTurns: 2,
    messageBuffer: [
      { type: "user", uuid: "u1" },
      { type: "assistant", uuid: "a1" },
      { type: "user", uuid: "u2" },
    ] as CoworkSessionRuntimeState["messageBuffer"],
  });
  accumulateCoworkCachedTotalTurnsOnStop(s);
  expect(s.cachedTotalTurns).toBe(4);
  expect(s.messageBuffer).toEqual([]);

  // undefined prior + empty buffer → 0
  const empty = session({ messageBuffer: [] });
  accumulateCoworkCachedTotalTurnsOnStop(empty);
  expect(empty.cachedTotalTurns).toBe(0);
  expect(empty.messageBuffer).toEqual([]);

  // multi-stop accumulates further
  empty.messageBuffer = [
    { type: "user", uuid: "u3" },
  ] as CoworkSessionRuntimeState["messageBuffer"];
  accumulateCoworkCachedTotalTurnsOnStop(empty);
  expect(empty.cachedTotalTurns).toBe(1);
  expect(empty.messageBuffer).toEqual([]);
});

it("formats official non-host-loop next-resume mount notify ({vm} literal)", () => {
  expect(coworkQueuedMountNextResumeMessage("/Users/me/proj", "proj")).toBe(
    "You now have access to /Users/me/proj. It will be available at /sessions/{vm}/mnt/proj on next resume.",
  );
  const s = session();
  expect(
    notifyCoworkQueuedMountNextResume(s, "/Users/me/proj", "proj", {
      preferSessionNotifications: true,
    }),
  ).toBe("queued");
  expect(s.pendingNotifications).toEqual([
    "You now have access to /Users/me/proj. It will be available at /sessions/{vm}/mnt/proj on next resume.",
  ]);
  const inv = session({ builtGen: 0, builtSystemPrompt: "p" });
  expect(
    notifyCoworkQueuedMountNextResume(inv, "/p", "p", {
      preferSessionNotifications: false,
    }),
  ).toBe("invalidated");
  expect(inv.builtGen).toBe(1);
  expect(inv.pendingNotifications).toEqual([]);
});

it("builds official space context system-reminder (buildSpaceContextReminder)", () => {
  expect(buildCoworkSpaceContextReminder(null)).toBeUndefined();
  expect(buildCoworkSpaceContextReminder(undefined)).toBeUndefined();
  expect(buildCoworkSpaceContextReminder({ name: "Work" })).toBe(
    '<system-reminder>This session has been organized into the "Work" project.</system-reminder>',
  );
  expect(
    buildCoworkSpaceContextReminder({
      name: "Work <x>",
      description: "desc <y>",
      instructions: "do <z>",
      links: [
        { title: "Docs <a>", url: "https://ex.ample/<b>" },
        { url: "https://only.url" },
      ],
    }),
  ).toBe(
    '<system-reminder>This session has been organized into the "Work x" project. Project description: desc y Project instructions: do z Project links: Docs a (https://ex.ample/b), https://only.url</system-reminder>',
  );
});

it("formats official worktree deleted/recycled pendingSystemReminder (U+2014)", () => {
  const deleted = coworkWorktreeDeletedSystemReminder(
    "/wt/old",
    "/repo/origin",
  );
  expect(deleted).toBe(
    `<system-reminder>
The git worktree at /wt/old was deleted. This session now operates on the origin repository at /repo/origin. File paths from earlier in the conversation that reference the worktree no longer exist \u2014 re-read files from the origin repository as needed.
</system-reminder>`,
  );
  expect(deleted).toContain("\u2014");

  const recycled = coworkWorktreeRecycledSystemReminder(
    "/wt/old",
    "/wt/new",
    "main",
  );
  expect(recycled).toBe(
    `<system-reminder>
The git worktree at /wt/old was recycled. This session now operates on a fresh worktree at /wt/new, checked out to the same branch (main). Absolute paths from earlier in the conversation that reference the old worktree no longer exist \u2014 re-read files from the new path as needed.
</system-reminder>`,
  );
  expect(recycled).toContain("\u2014");

  const s = session();
  setCoworkPendingSystemReminder(s, deleted);
  expect(s.pendingSystemReminder).toBe(deleted);
  // consume via createUserMessage / $MA
  const msg = createUserMessage(s, "hello", "uuid-wt");
  expect(String(msg.message.content)).toContain(
    "The git worktree at /wt/old was deleted",
  );
  expect(String(msg.message.content)).toContain("hello");
  expect(s.pendingSystemReminder).toBeUndefined();
});
