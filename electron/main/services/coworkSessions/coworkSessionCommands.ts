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
 * Official merge: session slash names → RT() (skip when isEnabled() false) → K2e.
 * Local shell always enables consolidate-memory (official gate ft("123929380") on for desktop Skills).
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

const exposedCommands: CoworkSlashCommand[] = [...rtSkills, ...coworkCliExposedCommands];

export async function getCoworkSupportedCommands(
  session?: CoworkSessionRuntimeState,
): Promise<CoworkSlashCommand[]> {
  const cliCommands = (await session?.query?.supportedCommands?.()) ?? [];
  const commands = new Map<string, CoworkSlashCommand>();

  for (const command of cliCommands) {
    if (!command.name) continue;
    commands.set(command.name, {
      aliases: command.aliases,
      argumentHint: command.argumentHint,
      description: command.description,
      name: command.name,
      scope: command.scope,
    });
  }

  // Official: RT() + K2e always appended with scope cowork; stamp scope even if CLI listed the name bare.
  for (const command of exposedCommands) {
    const existing = commands.get(command.name);
    if (!existing) {
      commands.set(command.name, command);
      continue;
    }
    commands.set(command.name, {
      ...existing,
      scope: "cowork",
      description: existing.description || command.description,
    });
  }

  return [...commands.values()];
}
