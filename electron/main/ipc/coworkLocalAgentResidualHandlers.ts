import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteLocalSkill,
  getLocalSkillFiles,
  listLocalSkills,
  revealLocalSkill,
  saveLocalSkill,
  setLocalSkillEnabled,
} from "../services/localSessions/localAgentAssets";
import { getDirectMcpConnectionManager } from "../services/mcp/directMcpConnectionManager";
import { requestMcpServer } from "../services/mcp/mcpRuntime";
import type { IpcHandlerContext } from "./context";
import { assertCoworkIpcOrigin } from "./coworkIpcOrigin";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";
import {
  abandonBridgeEnvironmentLive,
  kickBridgePollLive,
  resetBridgeLive,
  resetBridgeSessionLive,
  respondBridgePermissionPreflightLive,
} from "../services/coworkSessions/sessionsBridgeLifecycle";
import {
  deleteBridgeAgentMemoryResidual,
  deleteBridgeSessionResidual,
  getBridgeConsent,
  identityFromSettingsPrefs,
} from "../services/coworkSessions/sessionsBridgeResidual";
import {
  revokeEnterpriseInteractiveAuth,
  triggerEnterpriseInteractiveAuth,
} from "../services/custom3p/enterpriseInteractiveAuth";

/**
 * Residual LocalAgentModeSessions methods that were preload-listed but unregistered.
 *
 * Official app.asar shapes (nFt / CcA / lFt / oFt / wFt / DFt):
 * - skills: skillId/name/description/enabled + {ok,error?} mutations
 * - bridge: custom-3p residual → consent/enabled boolean, void poll/reset, delete false; yit status
 * - direct MCP: residual status bag via DirectMcpConnectionManager (URL remotes);
 *   custom3p MCP OAuth loopback (authorizeDirectMcpServer → _ni) — not Anthropic login
 * - interactive auth: Vertex / Bedrock SSO / bootstrap OIDC (never invent Anthropic 1p OAuth)
 * - folder TCC: desktop/documents/downloads ∈ {Granted,Denied,NotSupported}
 * - mcp resources: missing session → [] / {contents:[]}
 */

type FolderTccStatus = "Granted" | "Denied" | "NotSupported";

function secured(handler: IpcHandler): IpcHandler {
  return (event, ...args) => {
    assertCoworkIpcOrigin(event);
    return handler(event, ...args);
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Argument "${label}" to method on interface "LocalAgentModeSessions" failed to pass validation`,
    );
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function skillIdFromRecord(skill: Record<string, unknown>): string {
  return (
    optionalString(skill.key) ??
    optionalString(skill.skillId) ??
    optionalString(skill.name) ??
    optionalString(skill.id) ??
    "skill"
  );
}

function toOfficialSkill(skill: Record<string, unknown>) {
  return {
    skillId: skillIdFromRecord(skill),
    name: optionalString(skill.name) ?? skillIdFromRecord(skill),
    description:
      optionalString(skill.description) ?? optionalString(skill.title) ?? "",
    enabled: skill.enabled !== false,
    ...(optionalString(skill.updatedAt)
      ? { updatedAt: optionalString(skill.updatedAt) }
      : {}),
  };
}

async function probeFolderAccess(folderPath: string): Promise<FolderTccStatus> {
  try {
    await fs.readdir(folderPath);
    return "Granted";
  } catch {
    return "Denied";
  }
}

/**
 * Official `nor` residual: non-darwin → all NotSupported; else readdir probe.
 */
export async function requestFolderTccAccessResidual(): Promise<{
  desktop: FolderTccStatus;
  documents: FolderTccStatus;
  downloads: FolderTccStatus;
}> {
  if (process.platform !== "darwin") {
    return {
      desktop: "NotSupported",
      documents: "NotSupported",
      downloads: "NotSupported",
    };
  }
  const home = os.homedir();
  const [desktop, documents, downloads] = await Promise.all([
    probeFolderAccess(path.join(home, "Desktop")),
    probeFolderAccess(path.join(home, "Documents")),
    probeFolderAccess(path.join(home, "Downloads")),
  ]);
  return { desktop, documents, downloads };
}

function configuredMcpServers(
  context: IpcHandlerContext,
): Array<[string, unknown]> {
  try {
    const prefs = context.settings.getPreferences() as Record<string, unknown>;
    const raw =
      (prefs.mcpServers as Record<string, unknown> | undefined) ??
      (asRecord(prefs.claudeDesktopConfig).mcpServers as
        | Record<string, unknown>
        | undefined) ??
      {};
    return Object.entries(raw).filter(
      ([name, value]) =>
        typeof name === "string" &&
        typeof value === "object" &&
        value !== null,
    );
  } catch {
    return [];
  }
}

function mcpServerByNameOrUuid(
  context: IpcHandlerContext,
  nameOrUuid: string,
): { name: string; config: unknown } | null {
  for (const [name, config] of configuredMcpServers(context)) {
    if (name === nameOrUuid) return { name, config };
    const bag = asRecord(config);
    if (
      bag.uuid === nameOrUuid ||
      bag.id === nameOrUuid ||
      bag.serverUuid === nameOrUuid
    ) {
      return { name, config };
    }
  }
  return null;
}

export function createCoworkLocalAgentResidualHandlers(
  context: IpcHandlerContext,
): InterfaceHandlers {
  const manager = context.localAgentModeSessions;

  return {
    // ── Skills (localAgentAssets + official nFt/CcA wire) ──────────────────
    listLocalSkills: secured(async () => {
      const skills = await listLocalSkills();
      return skills.map((skill) => toOfficialSkill(skill));
    }),
    syncSkills: secured(async () => {
      // Official SkillsPlugin.syncSkills is a refresh; product re-reads disk.
      await listLocalSkills();
    }),
    getLocalSkillFiles: secured(async (_event, skillName) => {
      const name = requiredString(skillName, "name");
      const files = await getLocalSkillFiles(name);
      return files.map((file) => ({
        path:
          optionalString(file.relativePath) ??
          optionalString(file.name) ??
          optionalString(file.path) ??
          "SKILL.md",
        content:
          typeof file.content === "string" ? file.content : String(file.content ?? ""),
      }));
    }),
    saveLocalSkill: secured(
      async (_event, name, description, skillMd, overwrite) => {
        if (typeof name !== "string") {
          throw new Error(
            'Argument "name" at position 0 to method "saveLocalSkill" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        if (typeof description !== "string") {
          throw new Error(
            'Argument "description" at position 1 to method "saveLocalSkill" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        if (typeof skillMd !== "string") {
          throw new Error(
            'Argument "skillMd" at position 2 to method "saveLocalSkill" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        if (typeof overwrite !== "boolean") {
          throw new Error(
            'Argument "overwrite" at position 3 to method "saveLocalSkill" in interface "LocalAgentModeSessions" failed to pass validation',
          );
        }
        const trimmed = name.trim();
        if (!trimmed || trimmed === "." || trimmed === "..") {
          return { ok: false, error: `Invalid skill name: "${name}"` };
        }
        const existing = (await listLocalSkills()).find(
          (skill) =>
            skillIdFromRecord(skill) === trimmed ||
            optionalString(skill.name) === trimmed ||
            optionalString(skill.key) === trimmed,
        );
        if (existing && !overwrite) {
          return { ok: false, error: "already_exists" };
        }
        const saved = await saveLocalSkill({
          name: trimmed,
          description,
          content: skillMd,
        });
        if (!saved) return { ok: false, error: "save_failed" };
        return { ok: true };
      },
    ),
    deleteLocalSkill: secured(async (_event, skillName) => {
      const name = requiredString(skillName, "name");
      const ok = await deleteLocalSkill(name);
      return ok
        ? { ok: true }
        : { ok: false, error: `"${name}" is not a user-created skill` };
    }),
    setLocalSkillEnabled: secured(async (_event, skillName, enabled) => {
      const name = requiredString(skillName, "name");
      if (typeof enabled !== "boolean") {
        throw new Error(
          'Argument "enabled" at position 1 to method "setLocalSkillEnabled" in interface "LocalAgentModeSessions" failed to pass validation',
        );
      }
      const updated = await setLocalSkillEnabled(name, enabled);
      return updated
        ? { ok: true }
        : { ok: false, error: `Skill "${name}" not found` };
    }),
    revealLocalSkill: secured(async (_event, skillName) => {
      const name = requiredString(skillName, "name");
      await revealLocalSkill(name);
    }),

    // ── Sessions bridge shell residual (app.asar custom-3p / yit / QcA) ────
    // Shape 1:1: consent/enabled boolean; void poll/reset; yit status via store.
    // Live Anthropic poller not invented — shouldEnableSessionsBridge()=false.
    getBridgeConsent: secured(async () => {
      const prefs = context.settings.getPreferences() as Record<string, unknown>;
      return getBridgeConsent(identityFromSettingsPrefs(prefs));
    }),
    // Official: EQ()?.kick / forceNew / abandon / preflight; delete false without full map
    kickBridgePoll: secured(async () => {
      await kickBridgePollLive();
    }),
    resetBridge: secured(async () => {
      await resetBridgeLive();
    }),
    resetBridgeSession: secured(async () => {
      await resetBridgeSessionLive();
    }),
    abandonBridgeEnvironment: secured(async (_event, deregister) => {
      await abandonBridgeEnvironmentLive(deregister);
    }),
    deleteBridgeSession: secured(async () => deleteBridgeSessionResidual()),
    deleteBridgeAgentMemory: secured(async () => deleteBridgeAgentMemoryResidual()),
    respondBridgePermissionPreflight: secured(async (_event, requestId, proceed) => {
      await respondBridgePermissionPreflightLive(requestId, proceed);
    }),

    // ── Interactive auth residual (Vertex / Bedrock SSO / bootstrap OIDC) ──
    // Official: LocalAgentModeSessions.triggerInteractiveAuth → p1e / uHe / dPe.
    // Never invent { ok:true } without real browser/device/bootstrap success.
    triggerInteractiveAuth: secured(async () => {
      let userDataPath: string | undefined;
      try {
        userDataPath = path.dirname(context.settings.getSettingsFile());
      } catch {
        userDataPath = undefined;
      }
      const deps = userDataPath
        ? { getUserDataPath: () => userDataPath! }
        : {};
      return triggerEnterpriseInteractiveAuth(deps);
    }),
    revokeInteractiveAuth: secured(async () => {
      let userDataPath: string | undefined;
      try {
        userDataPath = path.dirname(context.settings.getSettingsFile());
      } catch {
        userDataPath = undefined;
      }
      const deps = userDataPath
        ? { getUserDataPath: () => userDataPath! }
        : {};
      return revokeEnterpriseInteractiveAuth(deps);
    }),

    // ── Folder TCC residual (official nor) ─────────────────────────────────
    requestFolderTccAccess: secured(async () => requestFolderTccAccessResidual()),

    // ── Direct MCP residual (URL remotes via product directMcpHost + custom3p OAuth) ──
    getDirectMcpServerStatuses: secured(async () => {
      const manager = getDirectMcpConnectionManager();
      // Lazy residual connectMcp: settings bag + managed + org-plugin scan.
      try {
        const bag = context.settings?.getMcpServersConfig?.() ?? {};
        await manager.connectFromConfigBag(bag as Record<string, unknown>);
      } catch (error) {
        console.warn(
          "[custom3p-mcp] connectFromConfigBag failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      return manager.getStatuses();
    }),
    authorizeDirectMcpServer: secured(async (_event, serverName) => {
      const name = requiredString(serverName, "name");
      // Residual authorizeDirectMcpServer → _ni(oauth) loopback (custom3p MCP only).
      return getDirectMcpConnectionManager().authorizePending(name);
    }),
    disconnectDirectMcpServer: secured(async (_event, serverName) => {
      const name = requiredString(serverName, "name");
      return getDirectMcpConnectionManager().disconnect(name);
    }),

    // ── MCP resources (official sessionId + serverUuid; missing → empty) ───
    mcpListResources: secured(async (_event, sessionId, serverUuid) => {
      const id = requiredString(sessionId, "sessionId");
      const uuid = requiredString(serverUuid, "serverUuid");
      try {
        await manager.initialize();
        if (!manager.getSession(id)) return [];
      } catch {
        return [];
      }
      const server = mcpServerByNameOrUuid(context, uuid);
      if (!server) return [];
      const result = await requestMcpServer({
        serverName: server.name,
        config: server.config,
        method: "resources/list",
      });
      const bag = asRecord(result);
      if (Array.isArray(bag.resources)) return bag.resources;
      if (Array.isArray(result)) return result;
      return [];
    }),
    mcpReadResource: secured(async (_event, sessionId, serverUuid, uri) => {
      const id = requiredString(sessionId, "sessionId");
      const uuid = requiredString(serverUuid, "serverUuid");
      const resourceUri = requiredString(uri, "uri");
      try {
        await manager.initialize();
        if (!manager.getSession(id)) return { contents: [] };
      } catch {
        return { contents: [] };
      }
      const server = mcpServerByNameOrUuid(context, uuid);
      if (!server) return { contents: [] };
      const result = await requestMcpServer({
        serverName: server.name,
        config: server.config,
        method: "resources/read",
        params: { uri: resourceUri },
      });
      const bag = asRecord(result);
      if (Array.isArray(bag.contents)) return { contents: bag.contents };
      return { contents: [] };
    }),
  };
}
