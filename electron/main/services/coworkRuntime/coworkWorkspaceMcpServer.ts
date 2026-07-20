/**
 * Official HostLoop workspace MCP (app.asar `x1i` / Cl="workspace"):
 *   mcp__workspace__bash
 *   mcp__workspace__web_fetch
 *
 * Bash runs inside the isolated Linux VM (UXe dual-exec). Without a product
 * dual-exec runner this module still registers the official tools and returns
 * the official "Workspace unavailable" / allowlist deny messages — it does
 * **not** invent host-side bash.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** Official Cl */
export const COWORK_WORKSPACE_MCP_NAME = "workspace";
/** Official sh / Ey tool names */
export const COWORK_WORKSPACE_BASH_TOOL = "bash";
export const COWORK_WORKSPACE_WEB_FETCH_TOOL = "web_fetch";
/** Official bhe */
export const COWORK_EGRESS_BLOCKED_TAG = "cowork-egress-blocked";
/** Official swA */
export const COWORK_WORKSPACE_BASH_DEFAULT_TIMEOUT_MS = 45_000;
/** Official G1i */
export const COWORK_WORKSPACE_VM_READY_PROBE_MS = 5_000;
/** Official IG */
export const COWORK_WORKSPACE_WEB_FETCH_DEFAULT_TIMEOUT_MS = 30_000;
/** Official pZ */
export const COWORK_WORKSPACE_WEB_FETCH_MAX_BYTES = 1_000_000;
/** Official Uhe */
export const COWORK_WORKSPACE_WEB_FETCH_MAX_REDIRECTS = 5;

export const COWORK_WORKSPACE_BASH_DESCRIPTION =
  "Run a shell command in the session's isolated Linux workspace. Your connected folders are mounted under /sessions/{vmProcessName}/mnt/ — the request_cowork_directory tool shows the exact mount path for each folder. Each bash call is independent (no cwd/env carryover). Use absolute paths. The workspace boots in the background and may not be ready on the first call; if so, you'll see 'Workspace still starting' — wait a few seconds and retry.";

export const COWORK_WORKSPACE_WEB_FETCH_DESCRIPTION =
  "Fetch a URL over HTTP(S). Access is restricted — the handler will explain what is reachable if a request is rejected. Do not add www. to URLs that do not have them. Returns the response body as text.";

export type CoworkWorkspaceVmStatus = "booting" | "ready" | "failed";

export type CoworkWorkspaceBashMounts = {
  mounts: Record<string, unknown>;
  vmCwd: string;
};

export type CoworkWorkspaceBashRunInput = {
  allowedDomains?: readonly string[] | null;
  command: string;
  mounts: CoworkWorkspaceBashMounts;
  processName: string;
  timeoutMs: number;
};

export type CoworkWorkspaceBashRunResult = {
  exitCode: number;
  output: string;
};

export type CoworkWorkspaceMcpServerOptions = {
  allowedDomains?: readonly string[] | null;
  /**
   * Official computeBashMounts(). Defaults to empty mounts +
   * `/sessions/<vmProcessName>/mnt/outputs` cwd placeholder.
   */
  computeBashMounts?: () => CoworkWorkspaceBashMounts;
  /**
   * Official O1i(vmReadyPromise). Defaults to immediate `"failed"` until
   * dual-exec product wire supplies a real probe.
   */
  getVmStatus?: () => Promise<CoworkWorkspaceVmStatus>;
  /**
   * Official Y1i / xeA bash runner. When unset, ready status still cannot run
   * (returns official failure text).
   */
  runBash?: (
    input: CoworkWorkspaceBashRunInput,
  ) => Promise<CoworkWorkspaceBashRunResult>;
  sessionId: string;
  sessionType?: string;
  vmProcessName: string;
  /**
   * Optional host fetch for web_fetch when allowlist permits.
   * Defaults to global `fetch` with redirect: "manual".
   */
  fetchImpl?: typeof fetch;
};

function textContent(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

/** Official YB */
export function coworkWorkspaceErrorResult(message: string) {
  return textContent(message, true);
}

/** Official Fhe */
export function coworkWorkspaceTextResult(message: string) {
  return textContent(message, false);
}

export function coworkWorkspaceBashDescription(vmProcessName: string): string {
  return COWORK_WORKSPACE_BASH_DESCRIPTION.replace(
    "{vmProcessName}",
    vmProcessName,
  );
}

/**
 * Official vmEgressPolicy shape from Ii().vmEgressPolicy() / settings.
 * Residual product: full settings store still optional inject.
 */
export type CoworkVmEgressPolicy =
  | { kind: "unrestricted" }
  | { kind: "allowlist"; domains: readonly string[] };

/**
 * Official cnA(policy) — unrestricted → ["*"], allowlist → domains, else undefined.
 */
export function coworkVmEgressPolicyToAllowedDomains(
  policy: CoworkVmEgressPolicy | null | undefined,
): string[] | undefined {
  if (!policy) return undefined;
  if (policy.kind === "unrestricted") return ["*"];
  return [...policy.domains];
}

/**
 * Official wFi(domains, otelConfig) without dual-exec n5e localhost→VM IP rewrite.
 * Appends OTLP endpoint hostname when missing and list is not unrestricted.
 * Residual: n5e host-IP rewrite for VM OTLP remains dual-exec-only.
 */
export function appendCoworkOtlpEndpointToAllowedDomains(
  domains: readonly string[] | null | undefined,
  otelConfig: { endpoint?: string | null } | null | undefined,
): string[] | null | undefined {
  if (!(otelConfig?.endpoint) || !domains || domains.includes("*")) {
    return domains == null ? domains : [...domains];
  }
  try {
    const host = new URL(otelConfig.endpoint).hostname;
    if (host && !domains.includes(host)) {
      return [...domains, host];
    }
  } catch {
    /* official logs parse failure; leave list unchanged */
  }
  return [...domains];
}

/**
 * Official resolveVmAllowedDomains(sessionEgress, otelConfig) core (without Ii settings):
 *   policy ? cnA(policy) : sessionEgress; then wFi(..., otel).
 * When getVmEgressPolicy inject is unset, session egressAllowedDomains is the product source.
 */
export function resolveCoworkWorkspaceAllowedDomains(options: {
  egressAllowedDomains?: readonly string[] | null;
  otelConfig?: { endpoint?: string | null } | null;
  vmEgressPolicy?: CoworkVmEgressPolicy | null;
}): string[] | null | undefined {
  const fromPolicy = coworkVmEgressPolicyToAllowedDomains(
    options.vmEgressPolicy,
  );
  const base =
    fromPolicy !== undefined
      ? fromPolicy
      : options.egressAllowedDomains == null
        ? options.egressAllowedDomains
        : [...options.egressAllowedDomains];
  return appendCoworkOtlpEndpointToAllowedDomains(base, options.otelConfig);
}

/**
 * Official U1i hostname allowlist match:
 *   "*" whole allowlist handled by caller
 *   exact host (case-insensitive)
 *   `*.suffix` suffix match
 */
export function coworkWorkspaceHostAllowed(
  hostname: string,
  pattern: string,
): boolean {
  if (pattern === "*") return true;
  const host = hostname.toLowerCase();
  const rule = pattern.toLowerCase();
  if (rule.startsWith("*.")) return host.endsWith(rule.slice(1));
  return host === rule;
}

/**
 * Official wbA — local/private host check (subset faithful to asar).
 */
export function coworkWorkspaceIsPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "localhost.localdomain" ||
    host === "ip6-localhost" ||
    host === "ip6-loopback"
  ) {
    return true;
  }
  const isPrivateV4 = (a: number, b: number) =>
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return isPrivateV4(Number(v4[1]), Number(v4[2]));
  if (host.includes(":")) {
    if (host === "::") return true;
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice("::ffff:".length);
      const m = mapped.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
      if (m) return isPrivateV4(Number(m[1]), Number(m[2]));
    }
  }
  return false;
}

/**
 * Official F1i(url, allowedDomains) — null when allowed, else deny message.
 */
export function classifyCoworkWorkspaceWebFetchDenial(
  url: URL,
  allowedDomains: readonly string[] | null | undefined,
): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `URL scheme "${url.protocol}" is not allowed. Use http or https.`;
  }
  if (coworkWorkspaceIsPrivateOrLocalHost(url.hostname)) {
    return `Host "${url.hostname}" is a local or private address.`;
  }
  if (!allowedDomains || allowedDomains.length === 0) {
    return `No network allowlist is configured for this session (${COWORK_EGRESS_BLOCKED_TAG}). The web_fetch tool is disabled.`;
  }
  if (
    allowedDomains.includes("*") ||
    allowedDomains.some((rule) =>
      coworkWorkspaceHostAllowed(url.hostname, rule),
    )
  ) {
    return null;
  }
  return `Host "${url.hostname}" is not on the network allowlist (${COWORK_EGRESS_BLOCKED_TAG}). The user can add it in Settings → Capabilities (or ask their workspace admin on Team/Enterprise). Allowed: ${allowedDomains.join(", ")}`;
}

export function officialWorkspaceUnavailableMessage(): string {
  return "Workspace unavailable. The isolated Linux environment failed to start. You can still use file tools directly.";
}

export function officialWorkspaceBootingMessage(): string {
  // Official: "usually 10...30 seconds" (minified ellipsis).
  return "Workspace still starting. The isolated Linux environment is booting in the background (usually 10-30 seconds). Try again shortly.";
}

async function defaultVmStatus(): Promise<CoworkWorkspaceVmStatus> {
  // Honest residual: dual-exec UXe vmReadyPromise not product-wired.
  return "failed";
}

function defaultMounts(vmProcessName: string): CoworkWorkspaceBashMounts {
  return {
    mounts: {},
    vmCwd: `/sessions/${vmProcessName}/mnt/outputs`,
  };
}

export function createCoworkWorkspaceMcpServerConfig(
  options: CoworkWorkspaceMcpServerOptions,
) {
  const getVmStatus = options.getVmStatus ?? defaultVmStatus;
  const computeBashMounts =
    options.computeBashMounts ?? (() => defaultMounts(options.vmProcessName));
  const fetchImpl = options.fetchImpl ?? fetch;
  const allowedDomains = options.allowedDomains ?? null;

  return createSdkMcpServer({
    alwaysLoad: true,
    name: COWORK_WORKSPACE_MCP_NAME,
    tools: [
      tool(
        COWORK_WORKSPACE_BASH_TOOL,
        coworkWorkspaceBashDescription(options.vmProcessName),
        {
          command: z
            .string()
            .describe("Shell command to execute (passed to bash -c)."),
          timeout_ms: z
            .number()
            .int()
            .positive()
            .max(COWORK_WORKSPACE_BASH_DEFAULT_TIMEOUT_MS)
            .optional()
            .describe(
              `Timeout in milliseconds. Default ${COWORK_WORKSPACE_BASH_DEFAULT_TIMEOUT_MS}.`,
            ),
        },
        async (args) => {
          const command =
            typeof args.command === "string" ? args.command : "";
          const timeoutMs =
            typeof args.timeout_ms === "number"
              ? args.timeout_ms
              : COWORK_WORKSPACE_BASH_DEFAULT_TIMEOUT_MS;
          const status = await getVmStatus();
          const mounts = computeBashMounts();
          if (status === "booting") {
            return coworkWorkspaceErrorResult(
              officialWorkspaceBootingMessage(),
            );
          }
          if (status === "failed") {
            return coworkWorkspaceErrorResult(
              officialWorkspaceUnavailableMessage(),
            );
          }
          if (!options.runBash) {
            // Ready without runner is still dual-exec residual.
            return coworkWorkspaceErrorResult(
              officialWorkspaceUnavailableMessage(),
            );
          }
          try {
            const result = await options.runBash({
              allowedDomains,
              command,
              mounts,
              processName: options.vmProcessName,
              timeoutMs,
            });
            const output =
              result.output.length > 0 ? result.output : "(no output)";
            if (result.exitCode === 0) {
              return coworkWorkspaceTextResult(output);
            }
            return coworkWorkspaceErrorResult(
              `Exit code ${result.exitCode}\n${output}`,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return coworkWorkspaceErrorResult(message);
          }
        },
      ),
      tool(
        COWORK_WORKSPACE_WEB_FETCH_TOOL,
        COWORK_WORKSPACE_WEB_FETCH_DESCRIPTION,
        {
          url: z.string().url().describe("The URL to fetch."),
          timeout_ms: z
            .number()
            .int()
            .positive()
            .max(COWORK_WORKSPACE_WEB_FETCH_DEFAULT_TIMEOUT_MS)
            .optional()
            .describe(
              `Timeout in milliseconds. Default ${COWORK_WORKSPACE_WEB_FETCH_DEFAULT_TIMEOUT_MS}.`,
            ),
        },
        async (args) => {
          const rawUrl = typeof args.url === "string" ? args.url : "";
          let current: URL;
          try {
            current = new URL(rawUrl);
          } catch {
            return coworkWorkspaceErrorResult(`Invalid URL: ${rawUrl}`);
          }
          const timeoutMs =
            typeof args.timeout_ms === "number"
              ? args.timeout_ms
              : COWORK_WORKSPACE_WEB_FETCH_DEFAULT_TIMEOUT_MS;

          for (
            let hop = 0;
            hop <= COWORK_WORKSPACE_WEB_FETCH_MAX_REDIRECTS;
            hop += 1
          ) {
            const denial = classifyCoworkWorkspaceWebFetchDenial(
              current,
              allowedDomains,
            );
            if (denial) {
              return coworkWorkspaceErrorResult(
                hop === 0
                  ? denial
                  : `Redirect to ${current.href} blocked: ${denial}`,
              );
            }

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let response: Response;
            try {
              response = await fetchImpl(current.href, {
                redirect: "manual",
                signal: controller.signal,
              });
            } catch (error) {
              clearTimeout(timer);
              const message =
                error instanceof Error ? error.message : String(error);
              return coworkWorkspaceErrorResult(`Fetch failed: ${message}`);
            }
            clearTimeout(timer);

            if (response.status >= 300 && response.status < 400) {
              await response.body?.cancel?.().catch(() => undefined);
              const location = response.headers.get("location");
              if (!location) {
                return coworkWorkspaceErrorResult(
                  `Redirect ${response.status} from ${current.href} had no Location header.`,
                );
              }
              try {
                current = new URL(location, current);
              } catch {
                return coworkWorkspaceErrorResult(
                  `Redirect ${response.status} from ${current.href} had invalid Location: ${location}`,
                );
              }
              continue;
            }

            const buffer = await readBodyCapped(
              response,
              COWORK_WORKSPACE_WEB_FETCH_MAX_BYTES,
            );
            if (!response.ok) {
              return coworkWorkspaceErrorResult(
                `HTTP ${response.status}: ${buffer.text}`,
              );
            }
            const header = [
              current.href,
              response.headers.get("content-type")
                ? `Content-Type: ${response.headers.get("content-type")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n");
            const body = buffer.truncated
              ? `${buffer.text}\n…(truncated at ${COWORK_WORKSPACE_WEB_FETCH_MAX_BYTES} bytes)`
              : buffer.text;
            return coworkWorkspaceTextResult(`${header}\n\n${body}`);
          }

          return coworkWorkspaceErrorResult(
            `Too many redirects (max ${COWORK_WORKSPACE_WEB_FETCH_MAX_REDIRECTS}).`,
          );
        },
      ),
    ],
  });
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (text.length <= maxBytes) return { text, truncated: false };
    return { text: text.slice(0, maxBytes), truncated: true };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.length > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      total += value.length;
      chunks.push(value);
    }
  } catch {
    /* fall through with whatever we have */
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

/**
 * Official UXe injects `{ workspace: x1i(...) }` into session mcpServers for
 * host-loop only. Non-host-loop leaves servers unchanged.
 */
export function withCoworkWorkspaceMcpServer(
  existing: Record<string, unknown> | undefined,
  options: CoworkWorkspaceMcpServerOptions | null | undefined,
): Record<string, unknown> {
  if (!options) return { ...(existing ?? {}) };
  return {
    ...(existing ?? {}),
    [COWORK_WORKSPACE_MCP_NAME]: createCoworkWorkspaceMcpServerConfig(options),
  };
}
