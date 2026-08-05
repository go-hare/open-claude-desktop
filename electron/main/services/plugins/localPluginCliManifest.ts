/**
 * Residual plugin.json CLI bag parse (app.asar H_ / Aoi / Fse / EI / iKe / Gq / wsr).
 * Used by LocalPlugins OAuth/env/shim IPC — not Anthropic account OAuth.
 *
 * data-official-source: app.asar index.js H_ / EI / Aoi / Gq / wsr / Xme
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PLUGIN_CLI_NAME,
  PLUGIN_SHIM_UNMATCHED_OP,
  pluginShimOpKey,
  pluginShimUnmatchedKey,
} from "./localPluginOAuthStore";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}

/** Residual Fse — command entry. */
export type PluginCliCommand = {
  op: string;
  match: string;
  description?: string;
  flag?: unknown;
  unless_flag?: unknown;
};

export type PluginCliEnvDecl = {
  envVar: string;
  displayName?: string;
  secret?: boolean;
  default?: string;
};

export type PluginCliBag = {
  oauth?: Record<string, unknown>;
  commands?: PluginCliCommand[];
  env?: Record<string, PluginCliEnvDecl>;
  network?: unknown[];
};

export type PluginManifestClis = Record<string, PluginCliBag>;

export type PluginIds = {
  marketplaceName: string;
  pluginName: string;
  cliName: string;
};

/** Residual Gq — parse pluginId marketplace. */
export function parsePluginIdMarketplace(
  pluginId: string,
): [string, string] | null {
  if (pluginId.includes("@")) {
    const at = pluginId.lastIndexOf("@");
    return [pluginId.substring(0, at), pluginId.substring(at + 1)];
  }
  if (pluginId.includes(":")) {
    const colon = pluginId.indexOf(":");
    return [pluginId.substring(colon + 1), pluginId.substring(0, colon)];
  }
  return null;
}

/** Residual wsr */
export function pluginIdsFrom(
  pluginId: string,
  pluginName: string,
  cliName: string,
): PluginIds {
  const parsed = parsePluginIdMarketplace(pluginId);
  const marketplaceName = parsed?.[1] ?? "";
  return {
    marketplaceName,
    pluginName,
    cliName,
  };
}

/** Residual Aoi */
function parseEnvBlock(
  env: Record<string, unknown>,
): Record<string, PluginCliEnvDecl> {
  const out: Record<string, PluginCliEnvDecl> = Object.create(null);
  for (const [key, raw] of Object.entries(env)) {
    if (!isPlainObject(raw)) continue;
    const envVar = raw.envVar;
    if (typeof envVar !== "string" || envVar.length === 0) continue;
    out[key] = {
      envVar,
      ...(typeof raw.displayName === "string"
        ? { displayName: raw.displayName }
        : {}),
      ...(raw.secret === true ? { secret: true } : {}),
      ...(typeof raw.default === "string" && raw.secret !== true
        ? { default: raw.default }
        : {}),
    };
  }
  return out;
}

function parseCommands(value: unknown): PluginCliCommand[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const commands = value.filter(
    (entry): entry is PluginCliCommand =>
      isPlainObject(entry) &&
      typeof entry.op === "string" &&
      typeof entry.match === "string",
  );
  return commands.length > 0 ? commands : undefined;
}

/**
 * Residual H_ — clis map from plugin.json.
 * Legacy: top-level oauth/confirm → { default: { oauth, commands } }.
 */
export function parsePluginClis(manifest: unknown): PluginManifestClis {
  const bag = asRecord(manifest);
  if (!bag) return {};
  if (isPlainObject(bag.clis)) {
    const out: PluginManifestClis = Object.create(null);
    for (const [name, raw] of Object.entries(bag.clis)) {
      if (!isPlainObject(raw)) continue;
      out[name] = {
        ...raw,
        oauth: isPlainObject(raw.oauth) ? raw.oauth : undefined,
        commands: parseCommands(raw.commands),
        env: isPlainObject(raw.env) ? parseEnvBlock(raw.env) : undefined,
        network: Array.isArray(raw.network) ? raw.network : undefined,
      };
    }
    return out;
  }
  const oauthValues = isPlainObject(bag.oauth)
    ? Object.values(bag.oauth)
    : [];
  const firstOauth = oauthValues.find((v) => isPlainObject(v)) as
    | Record<string, unknown>
    | undefined;
  return {
    [DEFAULT_PLUGIN_CLI_NAME]: {
      oauth: firstOauth,
      commands: parseCommands(bag.confirm),
    },
  };
}

/**
 * Residual EI / iKe — read `.claude-plugin/plugin.json` under install path.
 */
export function readPluginManifestAtInstallPath(
  installPath: string,
): Record<string, unknown> | null {
  const candidates = [
    path.join(installPath, ".claude-plugin", "plugin.json"),
    path.join(installPath, "plugin.json"),
    path.join(installPath, "manifest.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isPlainObject(parsed)) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Residual cPe simplified — stable hash of match/flags for shim key.
 * Official uses md5 of sorted JSON; product uses same field set for key stability.
 */
export function commandMatchHash(command: PluginCliCommand): string {
  const payload: Record<string, unknown> = { match: command.match };
  if (command.flag != null) payload.flag = command.flag;
  if (command.unless_flag != null) payload.unless_flag = command.unless_flag;
  return createHash("md5")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest("hex");
}

/** Residual EPe — op → keys including unmatched. */
export function expandPluginShimOpKeys(
  ids: PluginIds,
  commands: PluginCliCommand[],
): Array<{ op: string; key: string; description?: string }> {
  const out: Array<{ op: string; key: string; description?: string }> = [];
  for (const cmd of commands) {
    if (!cmd || typeof cmd.op !== "string") continue;
    out.push({
      op: cmd.op,
      key: pluginShimOpKey(
        ids.marketplaceName,
        ids.pluginName,
        ids.cliName,
        cmd.op,
        commandMatchHash(cmd),
      ),
      ...(typeof cmd.description === "string"
        ? { description: cmd.description }
        : {}),
    });
  }
  out.push({
    op: PLUGIN_SHIM_UNMATCHED_OP,
    key: pluginShimUnmatchedKey(
      ids.marketplaceName,
      ids.pluginName,
      ids.cliName,
    ),
  });
  return out;
}

/** Residual CPe — keys for selected ops (empty ops → unmatched only). */
export function shimKeysForOps(
  ids: PluginIds,
  commands: PluginCliCommand[],
  ops: string[],
): string[] {
  if (ops.length === 0) {
    return [
      pluginShimUnmatchedKey(
        ids.marketplaceName,
        ids.pluginName,
        ids.cliName,
      ),
    ];
  }
  const wanted = new Set(ops);
  return expandPluginShimOpKeys(ids, commands)
    .filter((entry) => wanted.has(entry.op))
    .map((entry) => entry.key);
}

export function resolveInstallPathFromPluginRecord(
  plugin: Record<string, unknown> | undefined | null,
): string | null {
  if (!plugin) return null;
  const direct =
    (typeof plugin.path === "string" && plugin.path) ||
    (typeof plugin.installPath === "string" && plugin.installPath) ||
    null;
  if (direct) return direct;
  const nested = asRecord(plugin.plugin);
  if (nested && typeof nested.path === "string" && nested.path) return nested.path;
  return null;
}
