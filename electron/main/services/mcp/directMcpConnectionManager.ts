/**
 * Residual-aligned Direct MCP connection bag (custom3p-mcp).
 * data-official-source: app.asar index.js Mse / _2e / _ni / N2e / M2e / Rni /
 *   connectMcp / buildConfig.mcpServers / authorizeDirectMcpServer /
 *   LocalAgentModeSessions.getDirectMcpServerStatuses / disconnectDirectMcpServer
 *
 * Product path:
 *   - Connects remote URL servers via spawnUtilityClient → product directMcpHost worker
 *   - headersHelper (m2e) for non-user-sourced helpers
 *   - OAuth: probe cached tokens (Rni); park NeedsInteractiveAuthError; authorize via N2e loopback
 *   - org-plugin scan (oce) + managedMcpServers merge when enterprise active
 *
 * Non-goals:
 *   - Anthropic account OAuth / Subscribe invent
 *   - Full enterprise Cai bootstrap graph
 */
import {
  disposeDirectMcpHost,
  spawnUtilityClient,
  type DirectMcpServerConnectConfig,
  type DirectMcpToolSummary,
  type SpawnUtilityClientResult,
} from "./directMcpHostManager";
import { resolveHeadersHelper } from "./headersHelper";
import {
  authorizeAndGetBearerHeaders,
  clearOAuthTokens,
  NeedsInteractiveAuthError,
  OAUTH_CANCELLED_BY_NEWER,
  oauthBearerHeaders,
  probeOAuthCached,
} from "./custom3pMcpOAuthProvider";
import {
  managedMcpServersFromEnterprise,
  mergePluginMcpConfigs,
  scanOrgPluginMcpServers,
} from "./orgPluginMcpScan";

export type DirectMcpServerDescriptor = {
  name: string;
  url: string;
  transport?: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  headersHelperTtlSec?: number;
  /** Residual oauth flag — truthy parks pending until authorize / cached token probe. */
  oauth?: unknown;
  toolPolicy?: Record<string, string>;
  source?: string;
  [key: string]: unknown;
};

export type DirectMcpStatusEntry = {
  name: string;
  url: string;
  isConnected: boolean;
  hasAuth: boolean;
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    _meta?: unknown;
  }>;
  toolPolicy?: Record<string, string>;
  /** Product diagnostic only — residual buildConfig omits; safe optional. */
  error?: string;
};

export type AuthorizeDirectMcpResult =
  | {
      ok: true;
      tools: Array<{
        name: string;
        description?: string;
        inputSchema?: unknown;
        _meta?: unknown;
      }>;
    }
  | { ok: false; error?: string; cancelled?: boolean };

type ConnectedEntry = {
  config: DirectMcpServerDescriptor;
  client: SpawnUtilityClientResult["client"];
  tools: DirectMcpToolSummary[];
  dispose: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const bag = asRecord(value);
  const entries = Object.entries(bag).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Normalize settings / bag entries into residual remote descriptors.
 * Only URL-based remotes are direct-MCP candidates (stdio stays in mcpRuntime).
 */
export function normalizeDirectMcpDescriptors(
  raw: Record<string, unknown> | null | undefined,
): DirectMcpServerDescriptor[] {
  if (!raw) return [];
  const out: DirectMcpServerDescriptor[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const bag = asRecord(value);
    const nested = asRecord(bag.config);
    const merged = { ...bag, ...nested };
    const url =
      asString(merged.url) ??
      asString(merged.endpoint) ??
      asString(merged.httpUrl) ??
      asString(merged.sseUrl);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const name = asString(merged.name) ?? key;
    const transport = asString(merged.transport) ?? asString(merged.type);
    const headers = stringRecord(merged.headers);
    const toolPolicy = stringRecord(merged.toolPolicy);
    const headersHelper = asString(merged.headersHelper);
    const headersHelperTtlSec =
      typeof merged.headersHelperTtlSec === "number"
        ? merged.headersHelperTtlSec
        : undefined;
    out.push(
      applyOAuthAuthExclusion({
        ...merged,
        name,
        url,
        ...(transport ? { transport } : {}),
        ...(headers ? { headers } : {}),
        ...(toolPolicy ? { toolPolicy } : {}),
        ...(headersHelper ? { headersHelper } : {}),
        ...(headersHelperTtlSec !== undefined ? { headersHelperTtlSec } : {}),
        oauth: merged.oauth,
        source: asString(merged.source),
      }),
    );
  }
  return out;
}

/**
 * Residual u_ for pending cancel race:
 * JSON.stringify([url, transport, oauth??false, headers??{}])
 */
export function descriptorIdentity(config: DirectMcpServerDescriptor): string {
  return JSON.stringify([
    config.url,
    config.transport ?? null,
    config.oauth ?? false,
    config.headers ?? {},
  ]);
}

/**
 * Residual JLA / managed mutual exclusion: oauth ∧ (headers || headersHelper)
 * keeps oauth, drops conflicting static auth fields.
 */
export function applyOAuthAuthExclusion(
  desc: DirectMcpServerDescriptor,
): DirectMcpServerDescriptor {
  if (!desc.oauth) return desc;
  if (!desc.headers && !desc.headersHelper) return desc;
  console.warn(
    `[custom3p-mcp] dropping headers/headersHelper for "${desc.name}" — oauth mutually exclusive (JLA residual)`,
  );
  const {
    headers: _h,
    headersHelper: _hh,
    headersHelperTtlSec: _ttl,
    ...rest
  } = desc;
  return rest;
}

function needsOAuth(config: DirectMcpServerDescriptor): boolean {
  return Boolean(config.oauth);
}

function toConnectConfig(
  config: DirectMcpServerDescriptor,
  extraHeaders?: Record<string, string>,
): DirectMcpServerConnectConfig {
  const headers =
    config.headers || extraHeaders
      ? { ...config.headers, ...extraHeaders }
      : undefined;
  return {
    name: config.name,
    url: config.url,
    transport: config.transport,
    headers,
  };
}

function mapTools(tools: DirectMcpToolSummary[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    _meta: tool._meta,
  }));
}

function authLabel(config: DirectMcpServerDescriptor): string {
  if (config.oauth) return "oauth-cached";
  if (config.headersHelper) return "headers-helper";
  if (config.headers) return "headers";
  return "open";
}

export class DirectMcpConnectionManager {
  private connected = new Map<string, ConnectedEntry>();
  private pending = new Map<string, DirectMcpServerDescriptor>();
  private failed = new Map<string, { config: DirectMcpServerDescriptor; error: string }>();
  private connectChain: Promise<void> = Promise.resolve();
  private statusListener: ((statuses: DirectMcpStatusEntry[]) => void) | null =
    null;

  setStatusListener(
    listener: ((statuses: DirectMcpStatusEntry[]) => void) | null,
  ): void {
    this.statusListener = listener;
  }

  private notify(): void {
    this.statusListener?.(this.getStatuses());
  }

  /**
   * Residual buildConfig.mcpServers shape for getDirectMcpServerStatuses.
   * Connected + pending OAuth + failed (failed is product diagnostic park).
   */
  getStatuses(): DirectMcpStatusEntry[] {
    const connected = [...this.connected.values()].map((entry) => ({
      name: entry.config.name,
      url: entry.config.url,
      isConnected: true,
      hasAuth: Boolean(entry.config.oauth),
      tools: mapTools(entry.tools),
      toolPolicy: entry.config.toolPolicy,
    }));
    const pending = [...this.pending.values()].map((config) => ({
      name: config.name,
      url: config.url,
      isConnected: false,
      hasAuth: Boolean(config.oauth),
      tools: [] as DirectMcpStatusEntry["tools"],
      toolPolicy: config.toolPolicy,
    }));
    const failed = [...this.failed.values()].map(({ config, error }) => ({
      name: config.name,
      url: config.url,
      isConnected: false,
      hasAuth: Boolean(config.oauth),
      tools: [] as DirectMcpStatusEntry["tools"],
      toolPolicy: config.toolPolicy,
      error,
    }));
    return [...connected, ...pending, ...failed];
  }

  getConnectedClient(name: string): ConnectedEntry | null {
    return this.connected.get(name) ?? null;
  }

  pendingOAuthConfig(name: string): DirectMcpServerDescriptor | undefined {
    return this.pending.get(name);
  }

  /**
   * Residual Mse — OAuth probe vs open/headers connect.
   * Already-connected same-name+url entries are skipped (status polls must not re-fork).
   */
  async connectServers(
    descriptors: readonly DirectMcpServerDescriptor[],
  ): Promise<{
    connected: number;
    pending: number;
    failed: number;
  }> {
    return this.enqueue(async () => {
      let connected = 0;
      let pending = 0;
      let failed = 0;
      for (const config of descriptors) {
        const existing = this.connected.get(config.name);
        if (existing && existing.config.url === config.url) {
          connected += 1;
          continue;
        }
        const priorFail = this.failed.get(config.name);
        if (priorFail && priorFail.config.url === config.url) {
          failed += 1;
          continue;
        }
        // Already pending same oauth config — keep park.
        const priorPending = this.pending.get(config.name);
        if (
          priorPending &&
          priorPending.url === config.url &&
          needsOAuth(config)
        ) {
          pending += 1;
          continue;
        }

        if (needsOAuth(config)) {
          try {
            await probeOAuthCached({
              name: config.name,
              url: config.url,
              transport: config.transport,
              oauth: config.oauth,
            });
            const bearer = oauthBearerHeaders(config.name);
            await this.connectOne(config, bearer);
            connected += 1;
          } catch (error) {
            // Residual Mse: OAuth branch failures always park pendingOAuth
            // (yUA → needs authorization; other → parked for retry / Connect).
            this.pending.set(config.name, config);
            this.failed.delete(config.name);
            pending += 1;
            if (error instanceof NeedsInteractiveAuthError) {
              console.info(
                "[custom3p-mcp] needs authorization — parked for renderer",
                { name: config.name },
              );
            } else {
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(
                "[custom3p-mcp] connect failed — parked for retry",
                { name: config.name, error: message },
              );
            }
          }
          continue;
        }

        try {
          await this.connectOne(config);
          connected += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.failed.set(config.name, { config, error: message });
          this.pending.delete(config.name);
          failed += 1;
          console.error("[custom3p-mcp] connect failed — parked for retry", {
            name: config.name,
            error: message,
          });
        }
      }
      this.notify();
      return { connected, pending, failed };
    });
  }

  /**
   * Residual connectMcp: settings bag + managed + org-plugin scan merge.
   */
  async connectFromConfigBag(
    raw: Record<string, unknown> | null | undefined,
  ): Promise<{
    connected: number;
    pending: number;
    failed: number;
  }> {
    const fromSettings = normalizeDirectMcpDescriptors(raw);
    const managed = managedMcpServersFromEnterprise().map((d) => ({
      ...d,
    })) as DirectMcpServerDescriptor[];
    let plugins: DirectMcpServerDescriptor[] = [];
    try {
      plugins = (await scanOrgPluginMcpServers()) as DirectMcpServerDescriptor[];
    } catch (error) {
      console.warn(
        "[custom3p-mcp] org plugin scan failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    // Residual: mdm first, then plugins (drop collisions); settings bag last merge by name.
    const base = mergePluginMcpConfigs(managed, plugins);
    const byName = new Map<string, DirectMcpServerDescriptor>();
    for (const d of base) byName.set(d.name, d);
    for (const d of fromSettings) {
      // User/settings entries override by name (local bag wins for same key).
      byName.set(d.name, d);
    }
    const descriptors = [...byName.values()];
    // Residual bag edit / delete: drop remotes no longer present in merged config.
    // Sequential remove is enqueue-safe (does not nest inside connectServers).
    const desired = new Set(descriptors.map((d) => d.name));
    for (const name of this.knownServerNames()) {
      if (!desired.has(name)) {
        await this.remove(name);
      }
    }
    if (descriptors.length === 0) {
      return { connected: 0, pending: 0, failed: 0 };
    }
    return this.connectServers(descriptors);
  }

  /** Names currently connected / pending / failed (bag prune helper). */
  knownServerNames(): string[] {
    return [
      ...new Set([
        ...this.connected.keys(),
        ...this.pending.keys(),
        ...this.failed.keys(),
      ]),
    ];
  }

  /**
   * Residual authorizeDirectMcpServer → _ni(oauth) then addConnectedDirectMcp.
   */
  async authorizePending(name: string): Promise<AuthorizeDirectMcpResult> {
    return this.enqueue(async () => {
      const pending = this.pending.get(name);
      if (!pending || !pending.oauth) {
        return {
          ok: false,
          error: `No pending MCP server named "${name}"`,
        };
      }
      console.info(
        `LocalAgentModeSessions.authorizeDirectMcpServer: ${name} — starting OAuth`,
      );
      const startedIdentity = descriptorIdentity(pending);
      try {
        const bearer = await authorizeAndGetBearerHeaders({
          name: pending.name,
          url: pending.url,
          transport: pending.transport,
          oauth: pending.oauth,
        });
        const still = this.pending.get(name);
        if (!still || descriptorIdentity(still) !== startedIdentity) {
          clearOAuthTokens(name);
          return { ok: false, cancelled: true };
        }
        await this.connectOne(pending, bearer);
        const entry = this.connected.get(name);
        const tools = (entry?.tools ?? []).filter(
          (tool) => pending.toolPolicy?.[tool.name] !== "blocked",
        );
        console.info(
          `LocalAgentModeSessions.authorizeDirectMcpServer: ${name} — ok, ${tools.length}/${entry?.tools.length ?? 0} tools`,
        );
        this.notify();
        return {
          ok: true,
          tools: mapTools(tools),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (message === OAUTH_CANCELLED_BY_NEWER) {
          console.info(
            `LocalAgentModeSessions.authorizeDirectMcpServer: ${name} — cancelled by newer attempt`,
          );
          return { ok: false, cancelled: true };
        }
        console.error(
          `LocalAgentModeSessions.authorizeDirectMcpServer: ${name} — failed: ${message}`,
        );
        return { ok: false, error: message };
      }
    });
  }

  /**
   * Residual disconnectDirectMcp(name): dispose, xv(oauth tokens), re-park for retry.
   * Transport onclose re-park does NOT clear tokens (only explicit disconnect/remove).
   */
  async disconnect(name: string): Promise<boolean> {
    return this.enqueue(async () => {
      const entry = this.connected.get(name);
      if (!entry) return false;
      entry.client.onclose = undefined;
      this.connected.delete(name);
      try {
        await entry.dispose();
      } catch {
        /* best-effort */
      }
      // Residual: i.config.oauth && xv(A)
      if (entry.config.oauth) {
        clearOAuthTokens(name);
      }
      this.pending.set(name, entry.config);
      this.notify();
      return true;
    });
  }

  /**
   * Residual removeDirectMcp: dispose + clear oauth tokens for connected/pending.
   */
  async remove(name: string): Promise<void> {
    await this.enqueue(async () => {
      const entry = this.connected.get(name);
      const pending = this.pending.get(name);
      if (entry) {
        entry.client.onclose = undefined;
        this.connected.delete(name);
        try {
          await entry.dispose();
        } catch {
          /* ignore */
        }
      }
      if (entry?.config.oauth || pending?.oauth) {
        clearOAuthTokens(name);
      }
      this.pending.delete(name);
      this.failed.delete(name);
      this.notify();
    });
  }

  async disposeAll(): Promise<void> {
    await this.enqueue(async () => {
      for (const entry of this.connected.values()) {
        entry.client.onclose = undefined;
        try {
          await entry.dispose();
        } catch {
          /* ignore */
        }
      }
      this.connected.clear();
      this.pending.clear();
      this.failed.clear();
      await disposeDirectMcpHost().catch(() => undefined);
      this.notify();
    });
  }

  private async connectOne(
    config: DirectMcpServerDescriptor,
    extraHeaders?: Record<string, string>,
  ): Promise<void> {
    const existing = this.connected.get(config.name);
    if (existing) {
      existing.client.onclose = undefined;
      this.connected.delete(config.name);
      try {
        await existing.dispose();
      } catch {
        /* ignore */
      }
    }

    // Residual _2e: m2e headersHelper then mUA(config, headers).
    const helperHeaders = await resolveHeadersHelper(config);
    const mergedExtra = {
      ...helperHeaders,
      ...extraHeaders,
    };
    const result = await spawnUtilityClient(
      toConnectConfig(
        config,
        Object.keys(mergedExtra).length > 0 ? mergedExtra : undefined,
      ),
    );
    const entry: ConnectedEntry = {
      config,
      client: result.client,
      tools: result.tools,
      dispose: result.dispose,
    };
    this.connected.set(config.name, entry);
    this.pending.delete(config.name);
    this.failed.delete(config.name);
    this.watchForClose(entry);
    console.info("[custom3p-mcp] connected", {
      name: config.name,
      toolCount: result.tools.length,
      auth: authLabel(config),
    });
  }

  private watchForClose(entry: ConnectedEntry): void {
    entry.client.onclose = () => {
      const current = this.connected.get(entry.config.name);
      if (current !== entry) return;
      this.connected.delete(entry.config.name);
      this.pending.set(entry.config.name, entry.config);
      console.warn(
        "[custom3p-mcp] transport closed — re-parked for reconnect",
        { server: entry.config.name },
      );
      this.notify();
    };
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.connectChain.then(fn, fn);
    this.connectChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

let sharedManager: DirectMcpConnectionManager | null = null;

export function getDirectMcpConnectionManager(): DirectMcpConnectionManager {
  if (!sharedManager) sharedManager = new DirectMcpConnectionManager();
  return sharedManager;
}

/** Test helper — reset singleton. */
export function resetDirectMcpConnectionManagerForTests(): void {
  sharedManager = null;
}
