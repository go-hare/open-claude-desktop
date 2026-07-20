/**
 * Official mcpDirectoryBridge skills reverse-RPC (app.asar c9e / Jxi / Kxi / qxi):
 *   addable_skills_search | slash_menu_skills_resolve
 *   data: JSON.stringify({ requestId, keywords?, skillNames? })
 * web responds respondSlashMenuSkills(requestId, JSON.stringify(skills[])).
 */
import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { dispatchBridgeEvent } from "../../ipc/registerIpc";

export type CoworkSlashSkill = {
  argumentHint?: string;
  description?: string;
  isUserCreated?: boolean;
  name: string;
  skillId?: string;
};

type PendingRequest = {
  resolve: (skills: CoworkSlashSkill[]) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const SKILLS_TIMEOUT_MS = 10_000;
const pendingSkills = new Map<string, PendingRequest>();

export type CoworkSkillsSlashBridgeDispatcher = {
  emit: (event: {
    data: string;
    sessionId: string;
    type: "addable_skills_search" | "slash_menu_skills_resolve";
  }) => void;
};

let activeDispatcher: CoworkSkillsSlashBridgeDispatcher | null = null;

export function setCoworkSkillsSlashBridgeDispatcher(
  dispatcher: CoworkSkillsSlashBridgeDispatcher | null,
): void {
  activeDispatcher = dispatcher;
}

export function createWebContentsSkillsSlashDispatcher(
  getWebContents: () => WebContents | null | undefined,
): CoworkSkillsSlashBridgeDispatcher {
  return {
    emit: (event) => {
      const wc = getWebContents();
      if (!wc || wc.isDestroyed()) return;
      dispatchBridgeEvent(wc, "claude.web", "LocalAgentModeSessions", "onEvent", event);
    },
  };
}

/** Official Jxi: resolve pending skills request (JSON array string). */
export function respondCoworkSlashMenuSkills(
  requestId: string,
  skillsJson: unknown,
): void {
  const pending = pendingSkills.get(requestId);
  if (!pending) {
    console.warn(
      "[skillsSlashBridge] Received response for unknown request: %s",
      requestId,
    );
    return;
  }
  clearTimeout(pending.timeout);
  pendingSkills.delete(requestId);
  pending.resolve(normalizeSkills(skillsJson));
}

function normalizeSkills(value: unknown): CoworkSlashSkill[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: CoworkSlashSkill[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.name !== "string" || raw.name.length === 0) continue;
    out.push({
      argumentHint:
        typeof raw.argumentHint === "string" ? raw.argumentHint : undefined,
      description:
        typeof raw.description === "string" ? raw.description : undefined,
      isUserCreated:
        typeof raw.isUserCreated === "boolean"
          ? raw.isUserCreated
          : typeof raw.is_user_created === "boolean"
            ? raw.is_user_created
            : undefined,
      name: raw.name,
      skillId:
        typeof raw.skillId === "string"
          ? raw.skillId
          : typeof raw.skill_id === "string"
            ? raw.skill_id
            : undefined,
    });
  }
  return out;
}

async function requestSkills(
  sessionId: string,
  type: "addable_skills_search" | "slash_menu_skills_resolve",
  payload: Record<string, unknown>,
): Promise<CoworkSlashSkill[]> {
  const dispatcher = activeDispatcher;
  if (!dispatcher) {
    console.warn("[skillsSlashBridge] No dispatcher available");
    return [];
  }
  const requestId = randomUUID();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingSkills.delete(requestId);
      console.warn("[skillsSlashBridge] %s request timed out: %s", type, requestId);
      resolve([]);
    }, SKILLS_TIMEOUT_MS);
    pendingSkills.set(requestId, { resolve, timeout });
    dispatcher.emit({
      data: JSON.stringify({ requestId, ...payload }),
      sessionId,
      type,
    });
  });
}

/** Official Kxi */
export function resolveCoworkSlashMenuSkills(
  sessionId: string,
  skillNames: string[] | undefined,
  keywords: string[] | undefined,
): Promise<CoworkSlashSkill[]> {
  return requestSkills(sessionId, "slash_menu_skills_resolve", {
    skillNames: skillNames ?? [],
    keywords: keywords ?? [],
  });
}

/** Official qxi */
export function searchCoworkAddableSkills(
  sessionId: string,
  keywords: string[] | undefined,
): Promise<CoworkSlashSkill[]> {
  return requestSkills(sessionId, "addable_skills_search", {
    keywords: keywords ?? [],
  });
}

export function clearCoworkSkillsSlashBridgeForTests(): void {
  for (const pending of pendingSkills.values()) clearTimeout(pending.timeout);
  pendingSkills.clear();
  activeDispatcher = null;
}
