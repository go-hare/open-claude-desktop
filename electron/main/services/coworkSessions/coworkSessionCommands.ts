import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

export type CoworkSlashCommand = {
  aliases?: string[];
  argumentHint?: string;
  description?: string;
  name: string;
  scope?: string;
};

const exposedCommands: CoworkSlashCommand[] = [
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
    description: "Show what's using your context window",
    name: "context",
    scope: "cowork",
  },
];

export async function getCoworkSupportedCommands(
  session?: CoworkSessionRuntimeState,
): Promise<CoworkSlashCommand[]> {
  const cliCommands = (await session?.query?.supportedCommands?.()) ?? [];
  const commands = new Map<string, CoworkSlashCommand>();
  for (const command of [...cliCommands, ...exposedCommands]) {
    if (!commands.has(command.name)) commands.set(command.name, command);
  }
  return [...commands.values()];
}
