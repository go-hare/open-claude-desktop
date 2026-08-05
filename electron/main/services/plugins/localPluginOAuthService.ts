/**
 * Residual LocalPlugins OAuth/env/shim IPC bodies (app.asar setPlugin* / revoke* / getPlugin*).
 *
 * Official gates:
 *   rC(ctx) CCD mode → not available
 *   Wp() feature 2307090146 — product residual: treat as enabled when local plugins exist
 *     (no GrowthBook invent false that permanently blocks storage)
 *   kc() account/org — product: resolvePluginsAccountCtx (identity or local-desktop fallback)
 *
 * startPluginOAuthFlow residual:
 *   i6t → r6t(R7) → NbA(PKCE+loopback+token) → git(credentials camelCase)
 * Does **not** invent success without accessToken write.
 *
 * data-official-source: app.asar LocalPlugins setImplementation OAuth methods / i6t / git
 */
import {
  parsePluginClis,
  pluginIdsFrom,
  readPluginManifestAtInstallPath,
  resolveInstallPathFromPluginRecord,
  shimKeysForOps,
  expandPluginShimOpKeys,
  type PluginCliBag,
  type PluginIds,
} from "./localPluginCliManifest";
import {
  runPluginOAuthI6t,
  PluginOAuthFlowError,
} from "./localPluginOAuthFlow";
import {
  applyPluginEnvMutations,
  clearPluginOAuthCredentials,
  collapseShimPermission,
  getPluginEnvValue,
  getPluginShimPermissionMap,
  isValidPluginEnvVarName,
  isReservedPluginEnvVar,
  PLUGIN_ENV_VAR_RE,
  pluginOAuthAccessToken,
  readPluginOAuthClient,
  readPluginOAuthCredentials,
  setPluginShimPermissions,
  writePluginOAuthClient,
  writePluginOAuthCredentials,
  type PluginEnvMutation,
} from "./localPluginOAuthStore";
import {
  resolvePluginsAccountCtx,
  type LocalPluginsAccountCtx,
} from "./localPluginsWriter";

export type LocalPluginOAuthContextMode = {
  mode?: string;
  telemetryAttempt?: unknown;
};

export type LocalPluginRecord = Record<string, unknown>;

function isCcdMode(ctx: LocalPluginOAuthContextMode | undefined): boolean {
  return ctx?.mode === "ccd";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type LocalPluginOAuthDeps = {
  getIdentity: () => {
    accountUuid?: string | null;
    organizationUuid?: string | null;
  } | null;
  listPlugins: () => LocalPluginRecord[];
};

function accountCtx(deps: LocalPluginOAuthDeps): LocalPluginsAccountCtx | null {
  return resolvePluginsAccountCtx({
    identity: deps.getIdentity(),
    allowFallback: true,
  });
}

function findPlugin(
  deps: LocalPluginOAuthDeps,
  pluginId: string,
): LocalPluginRecord | undefined {
  return deps.listPlugins().find((p) => String(p.id ?? "") === pluginId);
}

function installPathFor(
  deps: LocalPluginOAuthDeps,
  pluginId: string,
): string | null {
  return resolveInstallPathFromPluginRecord(findPlugin(deps, pluginId));
}

function loadCli(
  deps: LocalPluginOAuthDeps,
  pluginId: string,
  cliName: string,
): {
  installPath: string;
  manifest: Record<string, unknown>;
  cli: PluginCliBag;
  ids: PluginIds;
  pluginName: string;
} | null {
  const installPath = installPathFor(deps, pluginId);
  if (!installPath) return null;
  const manifest = readPluginManifestAtInstallPath(installPath);
  if (!manifest) return null;
  const clis = parsePluginClis(manifest);
  const cli = clis[cliName];
  if (!cli) return null;
  const pluginName =
    typeof manifest.name === "string" && manifest.name.length > 0
      ? manifest.name
      : pluginId;
  return {
    installPath,
    manifest,
    cli,
    ids: pluginIdsFrom(pluginId, pluginName, cliName),
    pluginName,
  };
}

/** Residual oye — per-cli oauth/env status bag. */
export function getPluginCliStatus(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): Record<string, unknown> {
  if (isCcdMode(contextMode)) return {};
  const id = asString(pluginId);
  if (!id) return {};
  const account = accountCtx(deps);
  if (!account) return {};
  const installPath = installPathFor(deps, id);
  if (!installPath) return {};
  const manifest = readPluginManifestAtInstallPath(installPath);
  if (!manifest) return {};
  const clis = parsePluginClis(manifest);
  const out: Record<string, unknown> = {};
  for (const [cliName, cli] of Object.entries(clis)) {
    const bag: Record<string, unknown> = {};
    if (cli.oauth) {
      const creds = readPluginOAuthCredentials(
        account.accountId,
        account.orgId,
        id,
        cliName,
      );
      bag.oauth = {
        // Residual connected when accessToken present (not empty bag).
        connected: pluginOAuthAccessToken(creds) != null,
        expiresAt: creds?.expiresAt,
        grantedScopes: creds?.grantedScopes,
      };
    }
    if (cli.env) {
      const envStatus: Record<string, unknown> = {};
      for (const [envKey, decl] of Object.entries(cli.env)) {
        const stored = getPluginEnvValue(
          account.accountId,
          account.orgId,
          id,
          cliName,
          envKey,
          decl.envVar,
        );
        const exposeValue =
          stored !== null &&
          decl.secret !== true &&
          stored.savedAsSecret !== true;
        envStatus[envKey] = {
          set: stored !== null,
          ...(exposeValue ? { value: stored!.value } : {}),
        };
      }
      bag.env = envStatus;
    }
    if (bag.oauth || bag.env) out[cliName] = bag;
  }
  return out;
}

/** Residual getPluginOAuthStatus — oauth slice of oye. */
export function getPluginOAuthStatus(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): Record<string, unknown> {
  const full = getPluginCliStatus(deps, pluginId, contextMode);
  const out: Record<string, unknown> = {};
  for (const [cliName, bag] of Object.entries(full)) {
    const rec = asRecord(bag);
    if (rec?.oauth) out[cliName] = rec.oauth;
  }
  return out;
}

export function setPluginEnvVars(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  cliName: unknown,
  values: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): { success: boolean; error?: string } {
  if (isCcdMode(contextMode)) {
    return { success: false, error: "Not available in CCD mode." };
  }
  const id = asString(pluginId);
  const cli = asString(cliName) ?? "default";
  const bag = asRecord(values) ?? {};
  if (!id) return { success: false, error: "Plugin not found." };
  const account = accountCtx(deps);
  if (!account) return { success: false, error: "No active account." };
  const loaded = loadCli(deps, id, cli);
  if (!loaded) return { success: false, error: "Plugin not found." };
  if (!loaded.cli.env) {
    return { success: false, error: `No env block declared for cli "${cli}".` };
  }
  try {
    const mutations: PluginEnvMutation[] = [];
    for (const [envKey, rawValue] of Object.entries(bag)) {
      const decl = loaded.cli.env[envKey];
      if (!decl) {
        return {
          success: false,
          error: `Unknown env key "${envKey}" for cli "${cli}".`,
        };
      }
      if (!isValidPluginEnvVarName(decl.envVar)) {
        return {
          success: false,
          error: `Manifest envVar "${decl.envVar}" is invalid or reserved.`,
        };
      }
      const value = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
      if (value === "") {
        const existing = getPluginEnvValue(
          account.accountId,
          account.orgId,
          id,
          cli,
          envKey,
          decl.envVar,
        );
        // Residual: delete only when not secret-only tombstone rules
        if (
          decl.secret !== true &&
          existing?.savedAsSecret !== true
        ) {
          mutations.push({
            op: "delete",
            envKey,
            envVar: decl.envVar,
          });
        }
        continue;
      }
      mutations.push({
        op: "set",
        envKey,
        envVar: decl.envVar,
        value,
        secret: decl.secret === true,
      });
    }
    applyPluginEnvMutations(
      account.accountId,
      account.orgId,
      id,
      cli,
      mutations,
    );
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function setPluginOAuthClient(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  cliName: unknown,
  clientId: unknown,
  clientSecret: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): { success: boolean; error?: string } {
  if (isCcdMode(contextMode)) {
    return { success: false, error: "Not available in CCD mode." };
  }
  const id = asString(pluginId);
  const cli = asString(cliName) ?? "default";
  if (!id) return { success: false, error: "Plugin not found." };
  const account = accountCtx(deps);
  if (!account) return { success: false, error: "No active account." };
  const loaded = loadCli(deps, id, cli);
  if (!loaded) return { success: false, error: "Plugin not found." };
  if (!loaded.cli.oauth) {
    return {
      success: false,
      error: `No oauth block declared for cli "${cli}".`,
    };
  }
  try {
    writePluginOAuthClient(account.accountId, account.orgId, id, cli, {
      clientId: typeof clientId === "string" ? clientId : undefined,
      clientSecret: typeof clientSecret === "string" ? clientSecret : undefined,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Residual startPluginOAuthFlow:
 *   gates → i6t(plugin, cli, oauth) → re-check account → git() → {success:true}
 */
export async function startPluginOAuthFlow(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  cliName: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): Promise<{ success: boolean; error?: string }> {
  if (isCcdMode(contextMode)) {
    return { success: false, error: "OAuth is not available in CCD mode." };
  }
  const id = asString(pluginId);
  const cli = asString(cliName) ?? "default";
  if (!id) return { success: false, error: "Plugin not found." };
  const account = accountCtx(deps);
  if (!account) return { success: false, error: "No active account." };
  const loaded = loadCli(deps, id, cli);
  if (!loaded) return { success: false, error: "Plugin not found." };
  if (!loaded.cli.oauth) {
    return {
      success: false,
      error: `OAuth provider "${cli}" not declared in plugin manifest.`,
    };
  }
  const storedClient = readPluginOAuthClient(
    account.accountId,
    account.orgId,
    id,
    cli,
  );
  const merged: Record<string, unknown> = {
    ...loaded.cli.oauth,
    ...(storedClient?.clientId ? { clientId: storedClient.clientId } : {}),
    ...(storedClient?.clientSecret
      ? { clientSecret: storedClient.clientSecret }
      : {}),
  };
  const clientId =
    typeof merged.clientId === "string" ? merged.clientId.trim() : "";
  if (!clientId) {
    return {
      success: false,
      error: `OAuth clientId for "${cli}" is not configured.`,
    };
  }
  // Residual r6t: envVar on oauth bag must pass pL + !wL when present.
  if (typeof merged.envVar === "string" && merged.envVar.length > 0) {
    if (
      !PLUGIN_ENV_VAR_RE.test(merged.envVar) ||
      isReservedPluginEnvVar(merged.envVar)
    ) {
      return {
        success: false,
        error: `envVar "${merged.envVar}" is reserved or invalid and cannot be used.`,
      };
    }
  }

  try {
    const credentials = await runPluginOAuthI6t(id, cli, merged);
    // Residual: account must be unchanged after interactive flow.
    const after = accountCtx(deps);
    if (
      !after ||
      after.accountId !== account.accountId ||
      after.orgId !== account.orgId
    ) {
      return {
        success: false,
        error: "Account context changed during the OAuth flow.",
      };
    }
    // Residual git()
    writePluginOAuthCredentials(
      account.accountId,
      account.orgId,
      id,
      cli,
      credentials,
    );
    return { success: true };
  } catch (error) {
    console.error("[LocalPlugins] Plugin OAuth flow failed:", error);
    const message =
      error instanceof PluginOAuthFlowError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { success: false, error: message };
  }
}

/** Residual revokePluginOAuth — void; clears credentials when account present. */
export function revokePluginOAuth(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  cliName: unknown,
  contextMode?: LocalPluginOAuthContextMode,
): void {
  if (isCcdMode(contextMode)) return;
  const id = asString(pluginId);
  const cli = asString(cliName) ?? "default";
  if (!id) return;
  const account = accountCtx(deps);
  if (!account) return;
  clearPluginOAuthCredentials(account.accountId, account.orgId, id, cli);
}

/** Residual getPluginShimOps */
export function getPluginShimOps(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  contextMode?: LocalPluginOAuthContextMode,
  cliName?: unknown,
): Array<Record<string, unknown>> {
  if (isCcdMode(contextMode)) return [];
  const id = asString(pluginId);
  if (!id) return [];
  const cli = asString(cliName) ?? "default";
  const loaded = loadCli(deps, id, cli);
  if (!loaded) return [];
  const commands = loaded.cli.commands ?? [];
  if (!loaded.cli.oauth && commands.length === 0) return [];
  const expanded = expandPluginShimOpKeys(loaded.ids, commands);
  const byOp = new Map<
    string,
    { keys: string[]; description?: string }
  >();
  for (const entry of expanded) {
    const cur = byOp.get(entry.op) ?? { keys: [] };
    cur.keys.push(entry.key);
    if (entry.description !== undefined && cur.description === undefined) {
      cur.description = entry.description;
    }
    byOp.set(entry.op, cur);
  }
  // Attach descriptions from commands for ops already present
  for (const cmd of commands) {
    const cur = byOp.get(cmd.op);
    if (cur && cur.description === undefined && typeof cmd.description === "string") {
      cur.description = cmd.description;
    }
  }
  const permMap = getPluginShimPermissionMap();
  return [...byOp.entries()].map(([op, { keys, description }]) => ({
    op,
    keys,
    permission: collapseShimPermission(
      keys.map((key) => permMap[key] as "allow" | "blocked" | undefined),
    ),
    ...(description !== undefined ? { description } : {}),
  }));
}

/** Residual setPluginShimPermission — returns affected keys. */
export function setPluginShimPermission(
  deps: LocalPluginOAuthDeps,
  pluginId: unknown,
  op: unknown,
  permission: unknown,
  contextMode?: LocalPluginOAuthContextMode,
  cliName?: unknown,
): string[] {
  const id = asString(pluginId);
  if (!id) return [];
  const cli = asString(cliName) ?? "default";
  const loaded = loadCli(deps, id, cli);
  if (!loaded) return [];
  const opName = asString(op);
  const keys = shimKeysForOps(
    loaded.ids,
    loaded.cli.commands ?? [],
    opName ? [opName] : [],
  );
  const perm =
    permission === "allow" || permission === "blocked" ? permission : null;
  setPluginShimPermissions(keys, perm);
  return keys;
}
