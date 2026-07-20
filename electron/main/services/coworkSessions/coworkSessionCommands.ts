import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

export type CoworkSlashCommand = {
  aliases?: string[];
  argumentHint?: string;
  description?: string;
  name: string;
  scope?: string;
};

/**
 * Official host RT() skills (schedule / setup-cowork / consolidate-memory W7)
 * + COWORK_CLI_EXPOSED_COMMANDS K2e (context).
 * Each carries scope:"cowork" so frontend aRe filters them for Built-in skills.
 *
 * Official LocalAgentModeSessionManager.getSupportedCommands(A):
 *   i = session.slashCommands.map(o => ({name:o, description:o}))
 *   r = RT() filtered by isEnabled (product: always enabled)
 *   return [...i, ...r, ...K2e]
 * Residual: real RT isEnabled() product gates not invented (always include).
 */
const rtSkills: CoworkSlashCommand[] = [
  {
    description:
      "Create a scheduled task that can be run on demand or automatically on an interval.",
    name: "schedule",
    scope: "cowork",
  },
  {
    description:
      "Guided Cowork setup \u2014 install a matching plugin, try a skill, connect tools.",
    name: "setup-cowork",
    scope: "cowork",
  },
  {
    description:
      "Reflective pass over your memory files \u2014 merge duplicates, fix stale facts, prune the index.",
    name: "consolidate-memory",
    scope: "cowork",
  },
];

const coworkCliExposedCommands: CoworkSlashCommand[] = [
  {
    description: "Show what's using your context window",
    name: "context",
    scope: "cowork",
  },
];

/**
 * Official init: `"slash_commands"in D && D.slash_commands` → assign string[].
 * Keep only non-empty strings; preserve first-seen order (no invent sort).
 */
export function extractCoworkSlashCommandNames(
  slashCommands: unknown,
): string[] {
  if (!Array.isArray(slashCommands)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of slashCommands) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Official merge order (not Map-dedupe of CLI+host):
 *   session slash names → RT() → K2e
 * Duplicate names across segments are kept in official order (product Map would
 * collapse; asar concatenates arrays — preserve concat for 1:1).
 */
export function mergeCoworkSupportedCommands(
  sessionSlashCommands?: readonly string[] | null,
): CoworkSlashCommand[] {
  const fromSession = (sessionSlashCommands ?? []).map((name) => ({
    name,
    description: name,
  }));
  return [...fromSession, ...rtSkills, ...coworkCliExposedCommands];
}

export async function getCoworkSupportedCommands(
  session?: CoworkSessionRuntimeState,
): Promise<CoworkSlashCommand[]> {
  // Official: prefer persisted/init slashCommands, not live query.supportedCommands
  // (Code LocalSessions uses live query — Cowork path is slashCommands + RT + K2e).
  return mergeCoworkSupportedCommands(session?.slashCommands);
}
