/**
 * Official residual (app.asar electron-shell-source index.js):
 *   voA = "Claude Preview"
 *   HOi = preview_* tool schemas (start/stop/list/logs/console/screenshot/…)
 *   KOi / rue = handleToolCall dispatcher
 *   isEnabled: ft("2976814254") || false && sessionType==="ccd" && !isSSH
 *              && gi("launchEnabled") !== false
 *   InternalMcpServerManager.createProxyServers → createSdkMcpServer-style
 *
 * Product:
 *   - createSdkMcpServer for host-loop / SDK query path (Cowork residual pattern)
 *   - localhost Streamable HTTP bridge for Code CLI `--mcp-config` (CLI cannot
 *     load non-serializable SDK instances; official uses in-process proxy —
 *     product CLI path uses HTTP MCP which the CLI already supports)
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { LocalLaunchManager } from "./localLaunchManager";
import type { LaunchPreviewViewManager } from "./launchPreviewViewManager";

/** Official voA */
export const CLAUDE_PREVIEW_MCP_NAME = "Claude Preview";

/** Official GfA — page-tool timeout 30s. */
const PREVIEW_PAGE_TOOL_TIMEOUT_MS = 30_000;

/** Official POi — tools that race against GfA timeout. */
const PREVIEW_PAGE_TOOLS = new Set([
  "preview_screenshot",
  "preview_snapshot",
  "preview_inspect",
  "preview_click",
  "preview_fill",
  "preview_eval",
  "preview_network",
  "preview_resize",
]);

/**
 * Official HOi tool names — schema source of truth from shell main.
 * Descriptions kept close to residual (no invent).
 */
export const CLAUDE_PREVIEW_TOOL_NAMES = [
  "preview_start",
  "preview_stop",
  "preview_list",
  "preview_logs",
  "preview_console_logs",
  "preview_screenshot",
  "preview_snapshot",
  "preview_inspect",
  "preview_click",
  "preview_fill",
  "preview_eval",
  "preview_network",
  "preview_resize",
] as const;

export type ClaudePreviewToolName = (typeof CLAUDE_PREVIEW_TOOL_NAMES)[number];

/** Official u5e launch.json template in HOi preview_start description. */
const LAUNCH_JSON_TEMPLATE = `{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "<unique-name>",
      "runtimeExecutable": "<command>",
      "runtimeArgs": ["<args>"],
      "port": <port>
    }
  ]
}`;

/** Official d5e. */
const LAUNCH_JSON_HINT =
  'Set "runtimeExecutable" to the command (e.g. "npm"), "runtimeArgs" to the arguments (e.g. ["run", "dev"]), and "port" to the server port. Only include servers you actually need to preview.';

const PREVIEW_START_DESCRIPTION =
  `Start a dev server by name from .claude/launch.json. If .claude/launch.json doesn't exist, create it first with this format:\n`
  + `${LAUNCH_JSON_TEMPLATE}\n`
  + `${LAUNCH_JSON_HINT} Reuses the server if already running. ALWAYS use this instead of Bash for running servers.`;

export type ClaudePreviewMcpHost = {
  launch: LocalLaunchManager;
  previewViews: LaunchPreviewViewManager;
  /**
   * Official gi("launchEnabled") residual — default true (SSA).
   * Only explicit false disables.
   */
  isLaunchEnabled: () => boolean;
  /**
   * Ensure WebContentsView + CDP context exists for a running server
   * (official D5e + sOi residual after start).
   */
  ensurePreviewContext: (serverId: string) => void;
  /**
   * Official isSSH residual for isEnabled. Product Code local = false.
   */
  isSSH?: () => boolean;
};

export type ClaudePreviewToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function textResult(message: string, isError = false): ClaudePreviewToolResult {
  return {
    content: [{ type: "text", text: message }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function errorResult(message: string): ClaudePreviewToolResult {
  return textResult(message, true);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === "string");
  return out.length > 0 ? out : undefined;
}

/**
 * Official isEnabled residual without inventing growthbook:
 *   (ft("2976814254") || false) && sessionType==="ccd" && !isSSH && gi("launchEnabled")!==false
 * Product treats feature flag as true when Launch is product-wired; gates on
 * launchEnabled + local non-SSH Code session at injection time.
 */
export function isClaudePreviewMcpEnabled(options: {
  isLaunchEnabled: boolean;
  sessionType?: string;
  isSSH?: boolean;
}): boolean {
  if (options.isLaunchEnabled === false) return false;
  if (options.isSSH === true) return false;
  // Official sessionType === "ccd". Product Code local sessions map to ccd.
  if (options.sessionType && options.sessionType !== "ccd") return false;
  return true;
}

/**
 * Official iue residual — resolve serverId or first running server for cwd.
 */
function resolveServerId(
  host: ClaudePreviewMcpHost,
  serverId: string | undefined,
  _sessionCwd: string,
): string | null {
  if (serverId && host.launch.getServer(serverId)) return serverId;
  const running = host.launch
    .getActiveServers()
    .find((server) => server.status === "running" || server.status === "starting");
  return running?.serverId ?? null;
}

async function withPageToolTimeout(
  toolName: string,
  run: () => Promise<ClaudePreviewToolResult>,
): Promise<ClaudePreviewToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<ClaudePreviewToolResult>((resolve) => {
        timer = setTimeout(() => {
          resolve(
            errorResult(
              `${toolName} timed out after ${PREVIEW_PAGE_TOOL_TIMEOUT_MS / 1000}s. The preview window may be stuck (modal dialog, navigation hang, or unresponsive renderer). Check preview_console_logs for errors.`,
            ),
          );
        }, PREVIEW_PAGE_TOOL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Official rue residual — dispatch preview_* tools against Launch + CDP.
 */
export async function handleClaudePreviewToolCall(
  toolName: string,
  args: Record<string, unknown>,
  sessionCwd: string,
  host: ClaudePreviewMcpHost,
): Promise<ClaudePreviewToolResult> {
  if (!host.isLaunchEnabled()) {
    return errorResult("Launch is disabled. Enable Launch in settings to use preview tools.");
  }

  const run = async (): Promise<ClaudePreviewToolResult> => {
    if (toolName === "preview_start") {
      try {
        const name = asString(args.name);
        if (!name) {
          return errorResult(
            'preview_start requires name (server name from .claude/launch.json).',
          );
        }
        const cwd = sessionCwd || process.cwd();
        // Official ePA reuse: if already running by name, reuse.
        const active = host.launch.getActiveServers();
        const byName = active.find(
          (server) =>
            server.name.toLowerCase() === name.toLowerCase()
            && (server.status === "running" || server.status === "starting"),
        );
        if (byName) {
          host.ensurePreviewContext(byName.serverId);
          return {
            content: [
              {
                type: "text",
                text:
                  `${JSON.stringify(
                    {
                      serverId: byName.serverId,
                      port: byName.port,
                      name: byName.name,
                      reused: true,
                    },
                    null,
                    2,
                  )}\n`
                  + "Server was already running and has been reused. No new process was started.",
              },
            ],
          };
        }
        const started = await host.launch.startFromConfig(cwd, name);
        if (started.error) {
          return errorResult(`Failed to start server: ${started.error}`);
        }
        if (!started.serverId) {
          return errorResult(
            `No server named "${name}" found in .claude/launch.json. Create .claude/launch.json with your dev server command, then try again.`,
          );
        }
        host.ensurePreviewContext(started.serverId);
        const record = host.launch.getServer(started.serverId);
        const payload = {
          serverId: started.serverId,
          port: record?.port,
          name: record?.name ?? name,
          reused: false,
        };
        return {
          content: [
            {
              type: "text",
              text:
                `${JSON.stringify(payload, null, 2)}\n`
                + `Server started successfully on port ${record?.port ?? "?"}.`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to start server: ${message}\n\nCheck the command in .claude/launch.json and try again.`);
      }
    }

    if (toolName === "preview_stop") {
      const serverId = asString(args.serverId);
      if (!serverId) return errorResult("preview_stop requires serverId.");
      const ok = await host.launch.stopServer(serverId);
      try {
        host.previewViews.destroy(serverId);
      } catch {
        /* best-effort */
      }
      return {
        content: [
          {
            type: "text",
            text: ok ? `Server ${serverId} stopped` : `Server ${serverId} not found`,
          },
        ],
        ...(ok ? {} : { isError: true as const }),
      };
    }

    if (toolName === "preview_list") {
      const servers = host.launch.getActiveServers();
      return {
        content: [{ type: "text", text: JSON.stringify(servers, null, 2) }],
      };
    }

    const resolvedId = resolveServerId(
      host,
      asString(args.serverId),
      sessionCwd,
    );
    if (!resolvedId) {
      return errorResult("Server not found. No running servers for this workspace.");
    }
    host.ensurePreviewContext(resolvedId);

    if (toolName === "preview_logs") {
      const level = asString(args.level) === "error" ? "error" : "all";
      const lines = Math.min(Math.max(1, asNumber(args.lines) ?? 50), 200);
      const search = asString(args.search);
      let logs = host.launch.getLogs(resolvedId);
      if (level === "error") {
        logs = logs.filter((item) => {
          const lower = item.line.toLowerCase();
          return (
            item.stream === "stderr"
            && (lower.includes("error")
              || lower.includes("exception")
              || lower.includes("failed")
              || lower.includes("fatal"))
          );
        });
      }
      if (search) {
        logs = logs.filter((item) => item.line.includes(search));
      }
      const slice = logs.slice(-lines);
      if (slice.length === 0) {
        return textResult(
          level === "error"
            ? "No server errors found."
            : search
              ? `No logs matching "${search}".`
              : "No logs yet.",
        );
      }
      return textResult(slice.map((item) => item.line).join("\n"));
    }

    if (toolName === "preview_console_logs") {
      const levelRaw = asString(args.level);
      const level =
        levelRaw === "error" || levelRaw === "warn" ? levelRaw : "all";
      const lines = Math.min(Math.max(1, asNumber(args.lines) ?? 50), 200);
      const all = host.previewViews.getConsoleLogs(resolvedId, level);
      if (all.length === 0) return textResult("No console logs.");
      const slice = all.slice(-lines);
      const body = slice.map((item) => `[${item.level}] ${item.text}`).join("\n");
      const more =
        all.length > lines
          ? `\n\n(Showing last ${lines} of ${all.length} entries.${
              lines < 200 ? " Use 'lines' parameter (max 200) to see more." : ""
            })`
          : "";
      return textResult(body + more);
    }

    if (toolName === "preview_screenshot") {
      try {
        const data =
          await host.previewViews.capturePreviewScreenshotCompressed(resolvedId);
        if (!data) return errorResult("Screenshot capture returned empty");
        return {
          content: [{ type: "image", data, mimeType: "image/jpeg" }],
        };
      } catch (error) {
        return errorResult(
          `Screenshot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_snapshot") {
      try {
        const text = await host.previewViews.takeSnapshotText(resolvedId);
        return textResult(text || "No accessible content found.");
      } catch (error) {
        return errorResult(
          `Snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_inspect") {
      const selector = asString(args.selector);
      if (!selector) {
        return errorResult("preview_inspect requires selector.");
      }
      try {
        const styles = asStringArray(args.styles);
        const info = await host.previewViews.inspectElement(
          resolvedId,
          selector,
          styles,
        );
        if (!info) return textResult(`Element not found: ${selector}`);
        return textResult(JSON.stringify(info));
      } catch (error) {
        return errorResult(
          `Inspect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_click") {
      const selector = asString(args.selector);
      if (!selector) return errorResult("preview_click requires selector.");
      try {
        const doubleClick = asBoolean(args.doubleClick) === true;
        const ok = await host.previewViews.click(resolvedId, selector, {
          doubleClick,
        });
        return ok
          ? textResult(
              `Successfully ${doubleClick ? "double-" : ""}clicked: ${selector}`,
            )
          : errorResult(`Failed to click element: ${selector}`);
      } catch (error) {
        return errorResult(
          `Click failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_fill") {
      const selector = asString(args.selector);
      const value = asString(args.value);
      if (!selector || value === undefined) {
        return errorResult("preview_fill requires selector and value.");
      }
      try {
        const ok = await host.previewViews.fill(resolvedId, selector, value);
        return ok
          ? textResult(`Successfully filled: ${selector}`)
          : errorResult(`Failed to fill element: ${selector}`);
      } catch (error) {
        return errorResult(
          `Fill failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_eval") {
      const expression = asString(args.expression);
      if (!expression) {
        return errorResult("preview_eval requires expression.");
      }
      try {
        const value = await host.previewViews.evaluate(resolvedId, expression);
        return textResult(
          value === undefined ? "undefined" : JSON.stringify(value, null, 2),
        );
      } catch (error) {
        return errorResult(
          `Eval failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (toolName === "preview_network") {
      const filterRaw = asString(args.filter);
      const filter = filterRaw === "failed" ? "failed" : "all";
      const requestId = asString(args.requestId);
      try {
        if (requestId) {
          const body = await host.previewViews.getResponseBody(
            resolvedId,
            requestId,
          );
          if (!body) {
            return errorResult(
              `Response body not available for request ${requestId}. It may have been evicted from the browser cache.`,
            );
          }
          if (body.base64Encoded) {
            return textResult(
              `Response is binary (base64-encoded, ${body.body.length} chars). Not displayed.`,
            );
          }
          let text = body.body;
          try {
            text = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            /* keep raw */
          }
          const max = 10_000;
          if (text.length > max) {
            text =
              `${text.slice(0, max)}\n... (truncated, ${body.body.length} total chars)`;
          }
          return textResult(text);
        }
        const entries = host.previewViews.getNetworkEntries(resolvedId, filter);
        if (entries.length === 0) {
          return textResult(
            filter === "failed" ? "No failed requests." : "No network requests recorded.",
          );
        }
        const lines = entries.map((entry) => {
          let line = `[${entry.requestId}] ${entry.method} ${entry.url}`;
          if (entry.status !== undefined) {
            line += ` → ${entry.status} ${entry.statusText ?? ""}`.trimEnd();
          }
          if (entry.failed) {
            line += ` [FAILED: ${entry.errorText ?? ""}]`;
          }
          return line;
        });
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(
          `Network request inspection failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (toolName === "preview_resize") {
      const preset = asString(args.preset) as
        | "mobile"
        | "tablet"
        | "desktop"
        | undefined;
      const width = asNumber(args.width);
      const height = asNumber(args.height);
      const colorScheme = asString(args.colorScheme) as
        | "light"
        | "dark"
        | undefined;
      try {
        const presets = {
          mobile: { w: 375, h: 812 },
          tablet: { w: 768, h: 1024 },
          desktop: { w: 1280, h: 800 },
        } as const;
        const messages: string[] = [];
        if (preset || width || height) {
          if (preset === "desktop") {
            await host.previewViews.clearPreviewViewport(resolvedId);
            messages.push("Viewport reset to native size (desktop)");
          } else {
            const size = preset
              ? presets[preset]
              : { w: width ?? 1280, h: height ?? 800 };
            await host.previewViews.setPreviewViewport(
              resolvedId,
              size.w,
              size.h,
              preset === "mobile",
            );
            messages.push(
              `Viewport set to ${size.w}x${size.h}${preset ? ` (${preset})` : ""}`,
            );
          }
        }
        if (colorScheme === "light" || colorScheme === "dark") {
          await host.previewViews.setPreviewColorScheme(resolvedId, colorScheme);
          messages.push(`Color scheme set to ${colorScheme}`);
        }
        if (messages.length === 0) {
          return errorResult(
            "Provide a preset (mobile/tablet/desktop), width/height, or colorScheme.",
          );
        }
        return textResult(`${messages.join(". ")}.`);
      } catch (error) {
        return errorResult(
          `Resize failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return errorResult("Unknown tool");
  };

  if (PREVIEW_PAGE_TOOLS.has(toolName)) {
    return withPageToolTimeout(toolName, run);
  }
  return run();
}

/**
 * Official HOi schemas as createSdkMcpServer (InternalMcp createProxyServers residual).
 * sessionCwd is resolved per call via getSessionCwd.
 */
export function createClaudePreviewMcpServerConfig(options: {
  host: ClaudePreviewMcpHost;
  getSessionCwd: () => string;
}) {
  const handle = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ClaudePreviewToolResult> =>
    handleClaudePreviewToolCall(
      name,
      args,
      options.getSessionCwd() || process.cwd(),
      options.host,
    );

  return createSdkMcpServer({
    alwaysLoad: true,
    name: CLAUDE_PREVIEW_MCP_NAME,
    tools: [
      tool(
        "preview_start",
        PREVIEW_START_DESCRIPTION,
        { name: z.string().describe("Server name from .claude/launch.json.") },
        async (args) => handle("preview_start", args as Record<string, unknown>),
      ),
      tool(
        "preview_stop",
        "Stop a server started with preview_start.",
        { serverId: z.string().describe("Server ID to stop") },
        async (args) => handle("preview_stop", args as Record<string, unknown>),
      ),
      tool(
        "preview_list",
        "List servers started with preview_start. Returns serverIds for use with other preview_* tools.",
        {},
        async (args) => handle("preview_list", args as Record<string, unknown>),
      ),
      tool(
        "preview_logs",
        "Get server stdout/stderr output. Use to check for build errors, verify server behavior, or read debug output. Use 'level' to filter to errors only, or 'search' to filter for specific text. Use after preview_start.",
        {
          serverId: z.string().describe("Server ID"),
          level: z.enum(["all", "error"]).optional(),
          lines: z.number().optional(),
          search: z.string().optional(),
        },
        async (args) => handle("preview_logs", args as Record<string, unknown>),
      ),
      tool(
        "preview_console_logs",
        "Get browser console output (log, info, warn, error, debug). Use to check runtime behavior, debug values, or client-side errors. Use 'level' to filter to errors or warnings only.",
        {
          serverId: z.string().describe("Server ID"),
          level: z.enum(["all", "error", "warn"]).optional(),
          lines: z.number().optional(),
        },
        async (args) =>
          handle("preview_console_logs", args as Record<string, unknown>),
      ),
      tool(
        "preview_screenshot",
        "Take a screenshot of the page. Good for checking layout and general appearance, but DO NOT rely on it for verifying colors, font sizes, or precise styles — use preview_inspect with specific CSS properties instead. Returns a compressed JPEG image.",
        { serverId: z.string().describe("Server ID") },
        async (args) =>
          handle("preview_screenshot", args as Record<string, unknown>),
      ),
      tool(
        "preview_snapshot",
        "Get an accessibility tree snapshot of the page. Returns exact text content, roles, and element UIDs for use with click/fill/hover. PREFERRED over screenshot for verifying text, element presence, and page structure.",
        { serverId: z.string().describe("Server ID") },
        async (args) =>
          handle("preview_snapshot", args as Record<string, unknown>),
      ),
      tool(
        "preview_inspect",
        "Inspect a DOM element by CSS selector. Returns text content, className, tagName, id, computed styles, and bounding box. BEST tool for verifying visual properties like colors, fonts, spacing, and dimensions — more accurate than screenshots.",
        {
          serverId: z.string().describe("Server ID"),
          selector: z.string().describe("CSS selector (e.g., '.button', '#header')"),
          styles: z.array(z.string()).optional(),
        },
        async (args) =>
          handle("preview_inspect", args as Record<string, unknown>),
      ),
      tool(
        "preview_click",
        `Click an element by CSS selector (e.g., 'button.primary', '#submit', '[data-testid="btn"]').`,
        {
          serverId: z.string().describe("Server ID"),
          selector: z.string().describe("CSS selector for the element to click"),
          doubleClick: z.boolean().optional(),
        },
        async (args) => handle("preview_click", args as Record<string, unknown>),
      ),
      tool(
        "preview_fill",
        "Fill an input, textarea, or select element with a value. For select elements, matches by value or text.",
        {
          serverId: z.string().describe("Server ID"),
          selector: z.string().describe("CSS selector for the input element"),
          value: z.string().describe("Value to fill"),
        },
        async (args) => handle("preview_fill", args as Record<string, unknown>),
      ),
      tool(
        "preview_eval",
        "Execute JavaScript in the preview page for DEBUGGING and INSPECTION only. Use for reading page state, DOM queries, checking variables, navigation, page reload, hover/type/key events. Do NOT use this to implement UI changes the user requests — edit the source code instead. Any DOM modifications via eval are temporary and lost on reload. Wrap multi-step logic in an IIFE.",
        {
          serverId: z.string().describe("Server ID"),
          expression: z
            .string()
            .describe(
              "JavaScript expression to evaluate in the page context. Return values are serialized as JSON.",
            ),
        },
        async (args) => handle("preview_eval", args as Record<string, unknown>),
      ),
      tool(
        "preview_network",
        "List network requests or inspect a specific response body. Without requestId, lists all requests with URL, method, status, and requestId. With requestId, returns the full response body for that request (useful for inspecting API payloads).",
        {
          serverId: z.string().describe("Server ID"),
          filter: z.enum(["all", "failed"]).optional(),
          requestId: z.string().optional(),
        },
        async (args) =>
          handle("preview_network", args as Record<string, unknown>),
      ),
      tool(
        "preview_resize",
        "Resize the preview viewport to test responsive layouts. Presets: mobile (375x812), tablet (768x1024), desktop (1280x800). Also supports custom dimensions and color scheme emulation for dark mode testing.",
        {
          serverId: z.string().describe("Server ID"),
          preset: z.enum(["mobile", "tablet", "desktop"]).optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          colorScheme: z.enum(["light", "dark"]).optional(),
        },
        async (args) =>
          handle("preview_resize", args as Record<string, unknown>),
      ),
    ],
  });
}

/**
 * Official HOi inputSchema surface for HTTP tools/list (CLI path).
 * Mirrors residual schemas without inventing extra fields.
 */
export const CLAUDE_PREVIEW_HTTP_TOOLS = [
  {
    name: "preview_start",
    description: PREVIEW_START_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Server name from .claude/launch.json.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "preview_stop",
    description: "Stop a server started with preview_start.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID to stop" },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_list",
    description:
      "List servers started with preview_start. Returns serverIds for use with other preview_* tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preview_logs",
    description:
      "Get server stdout/stderr output. Use to check for build errors, verify server behavior, or read debug output. Use 'level' to filter to errors only, or 'search' to filter for specific text. Use after preview_start.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        level: {
          type: "string",
          enum: ["all", "error"],
          description:
            "Filter by level: 'all' (default) shows all output, 'error' shows only lines containing error/exception/failed/fatal",
        },
        lines: {
          type: "number",
          description: "Max lines to return (default: 50)",
        },
        search: {
          type: "string",
          description:
            "Filter to lines containing this text (e.g., '[DEBUG]', 'POST /api')",
        },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_console_logs",
    description:
      "Get browser console output (log, info, warn, error, debug). Use to check runtime behavior, debug values, or client-side errors. Use 'level' to filter to errors or warnings only.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        level: {
          type: "string",
          enum: ["all", "error", "warn"],
          description:
            "Filter by level: 'all' (default), 'error' (errors only), 'warn' (warnings + errors)",
        },
        lines: {
          type: "number",
          description: "Max lines to return (default: 50, max: 200)",
        },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_screenshot",
    description:
      "Take a screenshot of the page. Good for checking layout and general appearance, but DO NOT rely on it for verifying colors, font sizes, or precise styles — use preview_inspect with specific CSS properties instead. Returns a compressed JPEG image.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_snapshot",
    description:
      "Get an accessibility tree snapshot of the page. Returns exact text content, roles, and element UIDs for use with click/fill/hover. PREFERRED over screenshot for verifying text, element presence, and page structure.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_inspect",
    description:
      "Inspect a DOM element by CSS selector. Returns text content, className, tagName, id, computed styles, and bounding box. BEST tool for verifying visual properties like colors, fonts, spacing, and dimensions — more accurate than screenshots.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        selector: {
          type: "string",
          description: "CSS selector (e.g., '.button', '#header')",
        },
        styles: {
          type: "array",
          items: { type: "string" },
          description:
            "CSS properties to return (e.g., ['padding', 'color']). Defaults to common properties.",
        },
      },
      required: ["serverId", "selector"],
    },
  },
  {
    name: "preview_click",
    description:
      `Click an element by CSS selector (e.g., 'button.primary', '#submit', '[data-testid="btn"]').`,
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        selector: {
          type: "string",
          description: "CSS selector for the element to click",
        },
        doubleClick: {
          type: "boolean",
          description: "Perform a double-click",
        },
      },
      required: ["serverId", "selector"],
    },
  },
  {
    name: "preview_fill",
    description:
      "Fill an input, textarea, or select element with a value. For select elements, matches by value or text.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        selector: {
          type: "string",
          description: "CSS selector for the input element",
        },
        value: { type: "string", description: "Value to fill" },
      },
      required: ["serverId", "selector", "value"],
    },
  },
  {
    name: "preview_eval",
    description:
      "Execute JavaScript in the preview page for DEBUGGING and INSPECTION only. Use for reading page state, DOM queries, checking variables, navigation, page reload, hover/type/key events. Do NOT use this to implement UI changes the user requests — edit the source code instead. Any DOM modifications via eval are temporary and lost on reload. Wrap multi-step logic in an IIFE.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        expression: {
          type: "string",
          description:
            "JavaScript expression to evaluate in the page context. Return values are serialized as JSON.",
        },
      },
      required: ["serverId", "expression"],
    },
  },
  {
    name: "preview_network",
    description:
      "List network requests or inspect a specific response body. Without requestId, lists all requests with URL, method, status, and requestId. With requestId, returns the full response body for that request (useful for inspecting API payloads).",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        filter: {
          type: "string",
          enum: ["all", "failed"],
          description:
            "Filter: 'all' (default) shows all requests, 'failed' shows only 4xx/5xx and network errors. Ignored when requestId is provided.",
        },
        requestId: {
          type: "string",
          description:
            "If provided, returns the response body for this specific request instead of listing all requests. Get requestIds from the listing output.",
        },
      },
      required: ["serverId"],
    },
  },
  {
    name: "preview_resize",
    description:
      "Resize the preview viewport to test responsive layouts. Presets: mobile (375x812), tablet (768x1024), desktop (1280x800). Also supports custom dimensions and color scheme emulation for dark mode testing.",
    inputSchema: {
      type: "object",
      properties: {
        serverId: { type: "string", description: "Server ID" },
        preset: {
          type: "string",
          enum: ["mobile", "tablet", "desktop"],
          description: "Device preset. Overrides width/height if provided.",
        },
        width: { type: "number", description: "Viewport width in pixels" },
        height: { type: "number", description: "Viewport height in pixels" },
        colorScheme: {
          type: "string",
          enum: ["light", "dark"],
          description:
            "Emulate prefers-color-scheme media feature for dark/light mode testing.",
        },
      },
      required: ["serverId"],
    },
  },
] as const;

type HostBridgeState = {
  server: http.Server;
  port: number;
  token: string;
  host: ClaudePreviewMcpHost;
  getSessionCwd: () => string;
};

let hostBridge: HostBridgeState | null = null;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunks.reduce((n, c) => n + c.length, 0) > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Minimal JSON-RPC MCP HTTP endpoint for Code CLI `--mcp-config type:http`.
 * Official path is in-process SDK; CLI spawn needs a serializable transport.
 * Bound to 127.0.0.1 only; requires bearer token.
 */
export async function ensureClaudePreviewHostBridge(options: {
  host: ClaudePreviewMcpHost;
  getSessionCwd: () => string;
}): Promise<{ url: string; headers: Record<string, string> } | null> {
  if (!options.host.isLaunchEnabled()) return null;

  if (hostBridge) {
    hostBridge.host = options.host;
    hostBridge.getSessionCwd = options.getSessionCwd;
    return {
      url: `http://127.0.0.1:${hostBridge.port}/mcp`,
      headers: { Authorization: `Bearer ${hostBridge.token}` },
    };
  }

  const token = randomUUID();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Mcp-Session-Id",
        });
        res.end();
        return;
      }

      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${token}`) {
        writeJson(res, 401, { error: "unauthorized" });
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        writeJson(res, 404, { error: "not_found" });
        return;
      }

      if (req.method === "GET") {
        // Streamable HTTP may probe GET; no SSE stream required for tools-only.
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const body = (await readJsonBody(req)) as {
        jsonrpc?: string;
        id?: string | number | null;
        method?: string;
        params?: Record<string, unknown>;
      };

      const id = body.id ?? null;
      const method = body.method ?? "";

      if (method === "initialize") {
        writeJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: {
              name: CLAUDE_PREVIEW_MCP_NAME,
              version: "1.0.0",
            },
          },
        });
        return;
      }

      if (method === "notifications/initialized" || method === "notifications/cancelled") {
        res.writeHead(202);
        res.end();
        return;
      }

      if (method === "tools/list") {
        writeJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result: { tools: CLAUDE_PREVIEW_HTTP_TOOLS },
        });
        return;
      }

      if (method === "tools/call") {
        const params = body.params ?? {};
        const name = asString(params.name) ?? "";
        const args =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        const state = hostBridge;
        if (!state) {
          writeJson(res, 200, {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: "Preview host bridge not ready" }],
              isError: true,
            },
          });
          return;
        }
        const result = await handleClaudePreviewToolCall(
          name,
          args,
          state.getSessionCwd() || process.cwd(),
          state.host,
        );
        writeJson(res, 200, {
          jsonrpc: "2.0",
          id,
          result,
        });
        return;
      }

      if (method === "ping") {
        writeJson(res, 200, { jsonrpc: "2.0", id, result: {} });
        return;
      }

      writeJson(res, 200, {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    } catch (error) {
      writeJson(res, 500, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    return null;
  }

  hostBridge = {
    server,
    port: address.port,
    token,
    host: options.host,
    getSessionCwd: options.getSessionCwd,
  };

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * Build serializable bare mcpServers map for Code CLI spawn merge.
 * Official uses non-serializable SDK instance; product CLI uses HTTP bridge.
 * Caller (`claudeCliRunner.pushCliMcpConfig`) wraps as `{ mcpServers }` for
 * CLI parseMcpConfig / McpJsonConfigSchema — do not return that wrapper here.
 */
export async function buildClaudePreviewCliMcpConfig(options: {
  host: ClaudePreviewMcpHost;
  getSessionCwd: () => string;
  isSSH?: boolean;
}): Promise<Record<string, unknown> | null> {
  if (
    !isClaudePreviewMcpEnabled({
      isLaunchEnabled: options.host.isLaunchEnabled(),
      sessionType: "ccd",
      isSSH: options.isSSH === true,
    })
  ) {
    return null;
  }
  const bridge = await ensureClaudePreviewHostBridge({
    host: options.host,
    getSessionCwd: options.getSessionCwd,
  });
  if (!bridge) return null;
  return {
    [CLAUDE_PREVIEW_MCP_NAME]: {
      type: "http",
      url: bridge.url,
      headers: bridge.headers,
      alwaysLoad: true,
    },
  };
}

/**
 * Merge Claude Preview SDK server into Cowork/host-loop mcpServers map
 * when enabled (ccd residual; Cowork may still benefit when Launch is on —
 * official only enables for ccd; keep that gate).
 */
export function withClaudePreviewSdkMcpServer(
  existing: Record<string, unknown> | undefined,
  options: {
    host: ClaudePreviewMcpHost;
    getSessionCwd: () => string;
    sessionType?: string;
    isSSH?: boolean;
  },
): Record<string, unknown> {
  const base = { ...(existing ?? {}) };
  if (
    !isClaudePreviewMcpEnabled({
      isLaunchEnabled: options.host.isLaunchEnabled(),
      sessionType: options.sessionType ?? "ccd",
      isSSH: options.isSSH === true,
    })
  ) {
    return base;
  }
  base[CLAUDE_PREVIEW_MCP_NAME] = createClaudePreviewMcpServerConfig({
    host: options.host,
    getSessionCwd: options.getSessionCwd,
  });
  return base;
}
