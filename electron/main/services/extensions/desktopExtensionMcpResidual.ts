/**
 * Official e6e / Gxi / bqt / YSA residual (app.asar):
 *
 *   async function e6e({forceReload}={forceReload:!1}) {
 *     if (!await isExtensionsEnabled()) return {};
 *     const byName = await getInstalledExtensionsByName({forceReload});
 *     for ([name, {id, manifest}] of byName) {
 *       settings = HN(id); if !enabled or orgBlocked skip
 *       i[name] = await Gxi(id, manifest)  // bqt mcp_config + ${} subst
 *     }
 *   }
 *   al() = { ...e6e(), ...(cnA() ? zo().mcpServers : {}) }
 *
 * Product: scan userData/extensions (listInstalledExtensionsSync), substitute
 * mcp_config, skip missing required user_config. Does not invent UV/built-in-node
 * spawn (Gxi still returns the substituted mcp_config bag for Agent SDK).
 */
import os from "node:os";
import path from "node:path";
import { isExtensionsEnabledResidual } from "../settings/extensionEnableGates";
import {
  listInstalledExtensionsSync,
  type ExtensionManifest,
  type InstalledExtension,
} from "./desktopExtensions";

export type ExtensionMcpSystemDirs = {
  DESKTOP?: string;
  DOCUMENTS?: string;
  DOWNLOADS?: string;
  HOME?: string;
};

export type LoadOfficialE6eMcpServersDeps = {
  extensionsEnabled?: boolean;
  getInstalledExtensions?: () => InstalledExtension[];
  homedir?: string;
  platform?: NodeJS.Platform;
  systemDirs?: ExtensionMcpSystemDirs;
  userDataPath?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isEmptyUserConfigValue(value: unknown): boolean {
  return value == null || value === "";
}

/** Official zOe — skip MCP when a required user_config field is empty. */
export function extensionMissingRequiredUserConfig(
  manifest: ExtensionManifest,
  userConfig: Record<string, unknown> | undefined,
): boolean {
  const spec = asRecord((manifest as Record<string, unknown>).user_config);
  if (Object.keys(spec).length === 0) return false;
  const values = userConfig ?? {};
  for (const [key, raw] of Object.entries(spec)) {
    const field = asRecord(raw);
    if (!field.required) continue;
    const value = values[key];
    if (isEmptyUserConfigValue(value)) return true;
    if (Array.isArray(value) && (value.length === 0 || value.some(isEmptyUserConfigValue))) {
      return true;
    }
  }
  return false;
}

/** Official YSA — recursive ${key} substitution. Arrays expand in array context. */
export function substituteExtensionMcpConfig(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    let next = value;
    for (const [key, replacement] of Object.entries(vars)) {
      const re = new RegExp(`\\$\\{${key}\\}`, "g");
      if (!next.match(re)) continue;
      if (Array.isArray(replacement)) {
        continue;
      }
      next = next.replace(re, String(replacement ?? ""));
    }
    return next;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (typeof item === "string" && /^\$\{user_config\.[^}]+\}$/.test(item)) {
        const key = item.slice(2, -1);
        const replacement = vars[key];
        if (replacement !== undefined) {
          if (Array.isArray(replacement)) out.push(...replacement);
          else out.push(replacement);
        } else {
          out.push(item);
        }
      } else {
        out.push(substituteExtensionMcpConfig(item, vars));
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substituteExtensionMcpConfig(nested, vars);
    }
    return out;
  }
  return value;
}

/** Official nPA / rYi — display_name || name; collision uses id. */
export function extensionMcpBagKey(
  extension: InstalledExtension,
  used: Record<string, unknown>,
): string {
  const label = extension.manifest.display_name || extension.manifest.name;
  return used[label] ? extension.id : label;
}

/** Official vxi() */
export function extensionMcpSystemDirs(
  deps: LoadOfficialE6eMcpServersDeps = {},
): ExtensionMcpSystemDirs {
  if (deps.systemDirs) return { ...deps.systemDirs };
  const home = deps.homedir ?? os.homedir();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronApp = require("electron").app as { getPath?: (name: string) => string };
    return {
      HOME: electronApp.getPath?.("home") ?? home,
      DESKTOP: electronApp.getPath?.("desktop"),
      DOCUMENTS: electronApp.getPath?.("documents"),
      DOWNLOADS: electronApp.getPath?.("downloads"),
    };
  } catch {
    return {
      HOME: home,
      DESKTOP: path.join(home, "Desktop"),
      DOCUMENTS: path.join(home, "Documents"),
      DOWNLOADS: path.join(home, "Downloads"),
    };
  }
}

/** Official bqt — platform_overrides + user_config defaults + YSA. */
export function buildExtensionMcpConfig(
  extension: InstalledExtension,
  deps: LoadOfficialE6eMcpServersDeps = {},
): Record<string, unknown> | undefined {
  const manifest = extension.manifest;
  const server = asRecord(manifest.server);
  const mcp = asRecord(server.mcp_config);
  if (Object.keys(mcp).length === 0) return undefined;
  let config: Record<string, unknown> = { ...mcp };
  const overrides = asRecord(mcp.platform_overrides);
  const platform = deps.platform ?? process.platform;
  const platformOverride = asRecord(overrides[platform]);
  if (Object.keys(platformOverride).length > 0) {
    config = {
      ...config,
      command: platformOverride.command ?? config.command,
      args: platformOverride.args ?? config.args,
      env: platformOverride.env ?? config.env,
    };
  }
  const userConfig = extension.settings.userConfig;
  if (extensionMissingRequiredUserConfig(manifest, userConfig)) return undefined;
  const vars: Record<string, unknown> = {
    __dirname: extension.path,
    pathSeparator: path.sep,
    "/": path.sep,
    ...extensionMcpSystemDirs(deps),
  };
  const defaults: Record<string, unknown> = {};
  const spec = asRecord((manifest as Record<string, unknown>).user_config);
  for (const [key, raw] of Object.entries(spec)) {
    const field = asRecord(raw);
    if (field.default !== undefined) defaults[key] = field.default;
  }
  if (userConfig) Object.assign(defaults, userConfig);
  for (const [key, value] of Object.entries(defaults)) {
    const bagKey = `user_config.${key}`;
    if (Array.isArray(value)) vars[bagKey] = value.map(String);
    else if (typeof value === "boolean") vars[bagKey] = value ? "true" : "false";
    else vars[bagKey] = String(value);
  }
  const substituted = substituteExtensionMcpConfig(config, vars);
  const out = asRecord(substituted);
  out.extensionId = extension.id;
  return out;
}

/**
 * Official e6e — enabled DXT/mcpb extensions as MCP server map keyed by
 * display_name (or id on collision). Empty when HN/isExtensionsEnabled is false.
 */
export function loadOfficialE6eMcpServers(
  deps: LoadOfficialE6eMcpServersDeps = {},
): Record<string, unknown> {
  const enabled =
    typeof deps.extensionsEnabled === "boolean"
      ? deps.extensionsEnabled
      : isExtensionsEnabledResidual();
  if (!enabled) return {};
  const installed =
    deps.getInstalledExtensions?.()
    ?? (deps.userDataPath ? listInstalledExtensionsSync(deps.userDataPath) : []);
  const out: Record<string, unknown> = {};
  for (const extension of installed) {
    if (extension.settings.isEnabled === false) continue;
    if (extension.settings.orgBlockedReason) continue;
    const config = buildExtensionMcpConfig(extension, deps);
    if (!config) continue;
    out[extensionMcpBagKey(extension, out)] = config;
  }
  return out;
}
