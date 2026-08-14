/**
 * Official LocalSessionManager createBaseHooks + createCanUseTool residual helpers
 * (app.asar: dtr/ptr worktree-write-guard, fkA unsupervised interactive block, Sit MCP gate,
 * xXi/YXi/HXi auto-allow + preview_start, zHA reuse/deny, Rze/Mze/_ze interactive matchers).
 *
 * Do not invent gates beyond residual matchers / decision shapes.
 */
import path from "node:path";
import { readLaunchJsonConfigurations, type LaunchJsonConfiguration } from "../launch/localLaunchManager";
import { getClaudePreviewMcpHost } from "../launch/claudePreviewHostRegistry";

/** Official dtr residual — file-edit tools guarded by worktree write check. */
export const OFFICIAL_WORKTREE_WRITE_TOOL_MATCHER = "Edit|Write|MultiEdit|NotebookEdit";

/** Official htr residual — path fields on edit tools. */
const WORKTREE_PATH_FIELDS = ["file_path", "notebook_path"] as const;

/**
 * Official interactive MCP tool name constants (app.asar):
 *   XHA="ccd_directory", pMA="request_directory" → Rze
 *   G4="ccd_session_mgmt", wMA="list_sessions", DMA="search_session_transcripts", mMA="archive_session"
 *   → JOi / _ze / Mze
 * PreToolUse matchers: Rze, `${Mze}|${_ze}` (+ Sit on mcp__.*).
 */
export const OFFICIAL_INTERACTIVE_MCP_TOOLS = {
  /** Rze — directory access outside cwd. */
  requestDirectory: "mcp__ccd_directory__request_directory",
  /** JOi residual (list_sessions) — still interactive; paired with Mze/_ze in fkA hooks. */
  listSessions: "mcp__ccd_session_mgmt__list_sessions",
  /** Mze */
  archiveSession: "mcp__ccd_session_mgmt__archive_session",
  /** _ze */
  searchSessionTranscripts: "mcp__ccd_session_mgmt__search_session_transcripts",
} as const;

/** Official Rze matcher string. */
export const OFFICIAL_PRETOOLUSE_MATCHER_RZE = OFFICIAL_INTERACTIVE_MCP_TOOLS.requestDirectory;

/** Official `${Mze}|${_ze}` matcher string. */
export const OFFICIAL_PRETOOLUSE_MATCHER_MZE_ZE =
  `${OFFICIAL_INTERACTIVE_MCP_TOOLS.archiveSession}|${OFFICIAL_INTERACTIVE_MCP_TOOLS.searchSessionTranscripts}`;

/**
 * Official YXi residual — preview MCP tools auto-allowed without permission prompt.
 * Includes preview_resize (app.asar YXi array).
 */
export const OFFICIAL_PREVIEW_AUTO_ALLOW_TOOLS = [
  "preview_stop",
  "preview_list",
  "preview_logs",
  "preview_console_logs",
  "preview_network",
  "preview_screenshot",
  "preview_snapshot",
  "preview_inspect",
  "preview_click",
  "preview_fill",
  "preview_eval",
  "preview_resize",
] as const;

/** Official ToA residual — Claude Preview MCP server display name. */
export const OFFICIAL_CLAUDE_PREVIEW_MCP_NAME = "Claude Preview";

export type WorktreeWriteGuardInput = {
  /** Official worktree path (session.worktreePath / session.cwd when in worktree). */
  worktreePath?: string | null;
  /** Official base repo (session.originCwd). */
  baseRepo?: string | null;
};

export type WorktreeWriteGuardResult =
  | { decision: undefined }
  | { decision: "block"; target: string; reason: string };

function pathApiFor(sample: string): path.PlatformPath {
  if (/^[A-Za-z]:[\\/]/.test(sample) || sample.startsWith("\\\\")) return path.win32;
  if (sample.startsWith("/")) return path.posix;
  return path;
}

/** Official z9 residual — is `target` inside `root` (relative, not absolute escape). */
function isPathInside(api: path.PlatformPath, target: string, root: string): boolean {
  const rel = api.relative(api.resolve(root), api.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !api.isAbsolute(rel);
}

/**
 * Official ptr residual: block writes outside the session worktree into base checkout
 * / sibling worktrees / shared .claude on the base repo.
 */
export function officialWorktreeWriteGuard(
  worktree: WorktreeWriteGuardInput | null | undefined,
  toolInput: Record<string, unknown>,
): WorktreeWriteGuardResult {
  if (!worktree?.worktreePath || !worktree.baseRepo) return { decision: undefined };
  const filePath = WORKTREE_PATH_FIELDS
    .map((key) => toolInput[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (filePath === undefined) return { decision: undefined };

  const api = pathApiFor(worktree.baseRepo);
  if (isPathInside(api, filePath, worktree.worktreePath)) return { decision: undefined };
  if (!isPathInside(api, filePath, worktree.baseRepo)) return { decision: undefined };

  const baseClaude = api.join(worktree.baseRepo, ".claude");
  const siblingRoot = api.join(baseClaude, "worktrees");
  const target = isPathInside(api, filePath, siblingRoot)
    ? "sibling_worktree"
    : isPathInside(api, filePath, baseClaude)
      ? "base_claude_dir"
      : "base_checkout";

  const prefix =
    `This session is running in an isolated git worktree at \`${worktree.worktreePath}\`, but \`${filePath}\` `;
  let reason: string;
  if (target === "base_checkout") {
    const alt = api.join(worktree.worktreePath, api.relative(worktree.baseRepo, filePath));
    reason =
      `${prefix}is in the base repo checkout. Edits there do not land on this session's branch `
      + `and may corrupt the user's primary working copy. Use the worktree path instead: \`${alt}\``;
  } else if (target === "sibling_worktree") {
    reason =
      `${prefix}belongs to a different worktree. Do not write to other worktrees' files from this session.`;
  } else {
    reason =
      `${prefix}is in the base repo's shared .claude/ directory. Edit the worktree's own .claude/ instead, `
      + `or run that change from a non-worktree session.`;
  }
  return { decision: "block", target, reason };
}

/**
 * Official fkA residual: interactive tools unavailable in unsupervised modes.
 * decision block when permissionMode is auto | bypassPermissions.
 */
export function officialUnsupervisedInteractiveGuard(
  permissionMode: string | undefined,
): { decision: "allow" } | { decision: "block"; reason: string } {
  if (permissionMode === "auto" || permissionMode === "bypassPermissions") {
    return {
      decision: "block",
      reason: "This tool requires user interaction and is unavailable in unsupervised mode.",
    };
  }
  return { decision: "allow" };
}

/**
 * Official Sit residual: mcp__server__tool disabled when enabledMcpTools[server:tool] === false.
 */
export function officialMcpToolEnabledGuard(
  toolName: string,
  enabledMcpTools: unknown,
): { decision: "allow" } | { decision: "block"; reason: string } {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/);
  if (!match) return { decision: "allow" };
  const key = `${match[1]}:${match[2]}`;
  if (
    enabledMcpTools
    && typeof enabledMcpTools === "object"
    && !Array.isArray(enabledMcpTools)
    && (enabledMcpTools as Record<string, unknown>)[key] === false
  ) {
    return {
      decision: "block",
      reason: "This tool has been disabled in your connector settings.",
    };
  }
  return { decision: "allow" };
}

/**
 * Official vit residual: bare tool name, or mcp__Claude_Preview__* → bare preview_* name.
 * ToA = "Claude Preview" → server segment Claude_Preview.
 */
export function officialClaudePreviewBareToolName(toolName: string): string | null {
  if (!toolName.includes("__")) return toolName;
  const parts = toolName.split("__");
  if (parts.length !== 3) return null;
  const [prefix, server, bare] = parts;
  if (prefix !== "mcp" || !server || !bare) return null;
  const expected = OFFICIAL_CLAUDE_PREVIEW_MCP_NAME.replace(/ /g, "_");
  if (server !== expected) return null;
  return bare;
}

/**
 * Official xXi residual: auto-allow without permission UI.
 * - mcp__terminal__read_terminal
 * - Claude Preview YXi list (via vit)
 */
export function officialAutoAllowTool(toolName: string): boolean {
  if (toolName === "mcp__terminal__read_terminal") return true;
  const bare = officialClaudePreviewBareToolName(toolName);
  if (bare === null) return false;
  return (OFFICIAL_PREVIEW_AUTO_ALLOW_TOOLS as readonly string[]).includes(bare);
}

/** Official HXi residual. */
export function officialIsPreviewStartTool(toolName: string): boolean {
  return officialClaudePreviewBareToolName(toolName) === "preview_start";
}

/**
 * Official interactive MCP tools that fkA blocks in auto/bypass.
 * Exact residual names first; keep includes heuristics for residual message shapes
 * when tool is registered under a different server slug.
 */
export function officialIsInteractiveMcpTool(toolName: string): boolean {
  const exact = Object.values(OFFICIAL_INTERACTIVE_MCP_TOOLS) as string[];
  if (exact.includes(toolName)) return true;
  // Residual message-shape fallbacks (same as prior includes when full mcp__ name differs).
  if (toolName.includes("request_directory") || toolName.includes("Request access to a directory")) {
    return true;
  }
  if (
    toolName.includes("list_sessions")
    || toolName.includes("archive_session")
    || toolName.includes("search_session_transcripts")
    || toolName.includes("other_sessions")
  ) {
    return true;
  }
  if (/mcp__.*__(ask_|elicit)/i.test(toolName)) return true;
  return false;
}

/** Official Ize residual — launch config → preview_start updatedInput. */
export function officialPreviewStartResolvedInput(
  config: Pick<LaunchJsonConfiguration, "command" | "args" | "cwd" | "port" | "name">,
): Record<string, unknown> {
  return {
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    port: config.port,
    name: config.name,
  };
}

export type OfficialPreviewStartPermissionResult =
  | { action: "deny"; message: string }
  | { action: "reuse"; config: LaunchJsonConfiguration; resolvedInput: Record<string, unknown> }
  | { action: "start"; config: LaunchJsonConfiguration; resolvedInput: Record<string, unknown> };

/**
 * Official zHA residual (handlePreviewStartPermission first gate):
 * read .claude/launch.json, match name, reuse running server or allow start→UI.
 * Does not start the process here — reuse short-circuits allow; start falls through
 * to handleToolPermission (user prompt).
 */
export async function officialPreviewStartPermission(
  toolInput: Record<string, unknown>,
  workingDirectory: string,
): Promise<OfficialPreviewStartPermissionResult> {
  const name = typeof toolInput.name === "string" && toolInput.name.length > 0
    ? toolInput.name
    : undefined;
  const servers = await readLaunchJsonConfigurations(workingDirectory);
  if (servers.length === 0) {
    return {
      action: "deny",
      message:
        `No .claude/launch.json found. Create ${workingDirectory}/.claude/launch.json with this format:\n`
        + `{\n  "version": "0.0.1",\n  "configurations": [\n    {\n      "name": "<unique-name>",\n`
        + `      "runtimeExecutable": "<command>",\n      "runtimeArgs": ["<args>"],\n      "port": <port>\n`
        + `    }\n  ]\n}\n`
        + `Set "runtimeExecutable" to the command (e.g. "npm"), "runtimeArgs" to the arguments `
        + `(e.g. ["run", "dev"]), and "port" to the server port. Only include servers you actually need to preview. `
        + `Then call preview_start with the server name.`,
    };
  }
  if (servers.length > 1 && !name) {
    return {
      action: "deny",
      message:
        `Multiple server configurations found: ${servers.map((c) => c.name).join(", ")}. `
        + `Specify which server to start by passing the name parameter (e.g., preview_start with name: "frontend" or name: "backend"). `
        + `To start all servers, call preview_start separately for each.`,
    };
  }
  let selected: LaunchJsonConfiguration | null = null;
  if (name) {
    selected = servers.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;
    if (!selected && servers.length === 1) selected = servers[0] ?? null;
  } else {
    selected = servers[0] ?? null;
  }
  if (!selected) {
    return {
      action: "deny",
      message:
        `No server named "${name}" found in .claude/launch.json. Available servers: `
        + `${servers.map((c) => c.name).join(", ")}. Pass one of these names, or add a new configuration for "${name}".`,
    };
  }

  const host = getClaudePreviewMcpHost();
  const running = (host?.launch.getActiveServers() ?? []).filter(
    (s) => s.status === "running" || s.status === "starting",
  );
  if (running.length > 0) {
    const byName = running.find((s) => s.name.toLowerCase() === selected!.name.toLowerCase());
    if (byName) {
      return {
        action: "reuse",
        config: selected,
        resolvedInput: officialPreviewStartResolvedInput(selected),
      };
    }
    const byPort = !name && selected.port != null
      ? running.find((s) => s.port === selected!.port)
      : undefined;
    if (byPort) {
      return {
        action: "reuse",
        config: selected,
        resolvedInput: officialPreviewStartResolvedInput(selected),
      };
    }
    if (running.length === 1 && servers.length === 1 && !name) {
      return {
        action: "reuse",
        config: selected,
        resolvedInput: officialPreviewStartResolvedInput(selected),
      };
    }
  }

  return {
    action: "start",
    config: selected,
    resolvedInput: officialPreviewStartResolvedInput(selected),
  };
}

/**
 * Official replaySessionPermissions residual:
 * sessionPermissionUpdates → merge allowedTools + additionalDirectories onto SDK options.
 */
export type SessionPermissionUpdate =
  | {
      type: "addRules" | "replaceRules";
      behavior: "allow" | "deny";
      rules: Array<{ toolName: string; ruleContent?: string }>;
      destination?: string;
    }
  | {
      type: "addDirectories";
      directories: string[];
      destination?: string;
    };

export function officialReplaySessionPermissions(
  updates: SessionPermissionUpdate[] | null | undefined,
  options: { allowedTools?: string[]; additionalDirectories?: string[] },
): void {
  if (!updates || updates.length === 0) return;
  const allowed = [...(options.allowedTools ?? [])];
  const dirs = [...(options.additionalDirectories ?? [])];
  for (const update of updates) {
    if ((update.type === "addRules" || update.type === "replaceRules") && update.behavior === "allow") {
      for (const rule of update.rules) {
        allowed.push(rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);
      }
    } else if (update.type === "addDirectories") {
      dirs.push(...update.directories);
    }
  }
  if (allowed.length > 0) options.allowedTools = [...new Set(allowed)];
  if (dirs.length > 0) options.additionalDirectories = [...new Set(dirs)];
}

/**
 * Official handleToolPermission short-circuit residual (app.asar CCD):
 * sessionPermissionUpdates allow rule with toolName match and no ruleContent
 * → allow permanently (skipped when permissionMode === plan).
 */
export function officialSessionPermissionAllowShortCircuit(
  updates: SessionPermissionUpdate[] | null | undefined,
  toolName: string,
  permissionMode: string | undefined,
): boolean {
  if (!updates || updates.length === 0) return false;
  if (permissionMode === "plan") return false;
  return updates.some(
    (update) =>
      (update.type === "addRules" || update.type === "replaceRules")
      && update.behavior === "allow"
      && update.rules.some((rule) => rule.toolName === toolName && !rule.ruleContent),
  );
}

/**
 * Official alwaysAllowedReasons cache residual:
 * key = `${toolName}:${decisionReason}` from prior "always" response.
 */
export function officialAlwaysAllowedReasonHit(
  reasons: string[] | Set<string> | null | undefined,
  toolName: string,
  decisionReason: string | undefined,
  permissionMode: string | undefined,
): boolean {
  if (!decisionReason || permissionMode === "plan") return false;
  if (!reasons) return false;
  const key = `${toolName}:${decisionReason}`;
  if (reasons instanceof Set) return reasons.has(key);
  return reasons.includes(key);
}

/**
 * Official xtr residual: interactive MCP tools strip permission suggestions
 * (handleToolPermission: if (r && xtr.has(t)) r = void 0).
 */
export const OFFICIAL_STRIP_SUGGESTIONS_TOOLS = new Set<string>([
  OFFICIAL_INTERACTIVE_MCP_TOOLS.requestDirectory,
  OFFICIAL_INTERACTIVE_MCP_TOOLS.archiveSession,
  OFFICIAL_INTERACTIVE_MCP_TOOLS.searchSessionTranscripts,
]);

/**
 * Official always+suggestions → sessionPermissionUpdates residual.
 * Skips browser:/computer: tool rules; destination must be "session".
 */
/**
 * Official remote-dispatch child deny residual (CCD handleToolPermission).
 * Exact message from app.asar.
 */
export function officialRemoteDispatchPermissionDeny(
  toolName: string,
  dispatchParentOrigin: string | undefined,
): { decision: "deny"; message: string } | null {
  if (dispatchParentOrigin !== "remote") return null;
  return {
    decision: "deny",
    message:
      `${toolName} requires approval, and sessions spawned by a remote dispatch orchestrator can't prompt. `
      + `Always-allow this tool in settings to use it here.`,
  };
}

/**
 * Official che residual — extract toolName list from permission suggestions.
 */
export function officialSuggestionToolNames(suggestions: unknown): string[] {
  if (!Array.isArray(suggestions)) return [];
  const out: string[] = [];
  for (const raw of suggestions) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type !== "addRules" && item.type !== "replaceRules") continue;
    if (!Array.isArray(item.rules)) continue;
    for (const rule of item.rules) {
      if (!rule || typeof rule !== "object") continue;
      const toolName = (rule as { toolName?: unknown }).toolName;
      if (typeof toolName === "string" && toolName.length > 0) out.push(toolName);
    }
  }
  return out;
}

/**
 * Official shouldAutoApprovePermission pure residual (store-backed approvals injected).
 * directory mount tools: mcp__cowork__request_cowork_directory (ql) + ccd_directory.
 */
export function officialScheduledTaskShouldAutoApprove(input: {
  toolName: string;
  suggestions: unknown;
  approvedToolNames: string[] | null | undefined;
}): boolean {
  const rules = officialSuggestionToolNames(input.suggestions);
  if (rules.length === 0) return false;
  if (
    input.toolName === "mcp__cowork__request_cowork_directory"
    || input.toolName === "mcp__ccd_directory__request_directory"
  ) {
    return false;
  }
  if (rules.some((name) => name.startsWith("plugin-shim:"))) return false;
  const approved = new Set(input.approvedToolNames ?? []);
  return rules.every((name) => approved.has(name));
}

export function officialSessionDestinationSuggestions(
  suggestions: unknown,
): {
  directories: string[];
  rules: Array<{ toolName: string; ruleContent?: string }>;
  setMode?: string;
} {
  const directories: string[] = [];
  const rules: Array<{ toolName: string; ruleContent?: string }> = [];
  let setMode: string | undefined;
  if (!Array.isArray(suggestions)) return { directories, rules };
  for (const raw of suggestions) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.destination !== "session" && item.type !== "setMode") continue;
    if (item.type === "setMode" && typeof item.mode === "string") {
      setMode = item.mode;
      continue;
    }
    if (item.destination !== "session") continue;
    if (item.type === "addDirectories" && Array.isArray(item.directories)) {
      for (const d of item.directories) {
        if (typeof d === "string" && d.length > 0) directories.push(d);
      }
    }
    if (
      (item.type === "addRules" || item.type === "replaceRules")
      && Array.isArray(item.rules)
    ) {
      for (const rule of item.rules) {
        if (!rule || typeof rule !== "object") continue;
        const r = rule as Record<string, unknown>;
        const toolName = typeof r.toolName === "string" ? r.toolName : "";
        if (!toolName) continue;
        if (toolName.startsWith("browser:") || toolName.startsWith("computer:")) continue;
        const ruleContent = typeof r.ruleContent === "string" ? r.ruleContent : undefined;
        rules.push(ruleContent ? { toolName, ruleContent } : { toolName });
      }
    }
  }
  return { directories, rules, setMode };
}
