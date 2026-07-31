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
import { requestMcpServer } from "../services/mcp/mcpRuntime";
import type { IpcHandlerContext } from "./context";
import { assertCoworkIpcOrigin } from "./coworkIpcOrigin";
import type { InterfaceHandlers, IpcHandler } from "./registerIpc";

/**
 * Residual LocalAgentModeSessions methods that were preload-listed but unregistered.
 *
 * Official app.asar shapes (nFt / CcA / lFt / oFt / wFt / DFt):
 * - skills: skillId/name/description/enabled + {ok,error?} mutations
 * - bridge: 3p/no remote bridge → consent false, poll/reset no-op, delete false
 * - direct MCP OAuth: no pending → {ok:false,error}; statuses []
 * - interactive auth: idle/null residual (no invent Gateway SSO / Anthropic OAuth)
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

    // ── Sessions bridge (no Anthropic remote bridge in 3p product) ─────────
    // Honest empty/disabled — never soft-true success that implies remote bridge is live.
    getBridgeConsent: secured(async () => ({
      granted: false,
      reason: "sessions_bridge_unavailable",
    })),
    kickBridgePoll: secured(async () => false),
    resetBridge: secured(async () => false),
    resetBridgeSession: secured(async () => false),
    abandonBridgeEnvironment: secured(async () => false),
    deleteBridgeSession: secured(async () => false),
    deleteBridgeAgentMemory: secured(async () => false),
    respondBridgePermissionPreflight: secured(async () => false),

    // ── Interactive auth residual (no invent OAuth / Gateway SSO success) ──
    triggerInteractiveAuth: secured(async () => ({
      ok: false,
      error: "interactive_auth_not_available",
    })),
    // No interactive auth session to revoke in 3p residual path.
    revokeInteractiveAuth: secured(async () => false),

    // ── Folder TCC residual (official nor) ─────────────────────────────────
    requestFolderTccAccess: secured(async () => requestFolderTccAccessResidual()),

    // ── Direct MCP residual (no fake OAuth authorize success) ──────────────
    getDirectMcpServerStatuses: secured(async () => {
      // Official returns connection statuses; product has no OAuth direct MCP manager.
      // Honest empty list — not soft-true "authorized".
      return [];
    }),
    authorizeDirectMcpServer: secured(async (_event, serverName) => {
      const name = requiredString(serverName, "name");
      return {
        ok: false,
        error: `No pending MCP server named "${name}"`,
      };
    }),
    disconnectDirectMcpServer: secured(async () => false),

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
