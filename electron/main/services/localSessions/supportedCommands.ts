import os from "node:os";
import readline from "node:readline";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { defaultClaudeExecutable, spawnClaude } from "./claudeCliRunner";
import type { LocalSessionStore } from "./localSessionStore";

export type SupportedSlashCommand = {
  aliases?: string[];
  argumentHint?: string;
  description?: string;
  name: string;
  scope?: string;
};

export type GetSupportedCommandsRequest = {
  cwd?: string;
  sessionId?: string;
};

const colorNames = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
const commandCache = new Map<string, Promise<SupportedSlashCommand[]>>();
const temporaryQueryTimeoutMs = 15_000;

export function getSupportedCommands(store: LocalSessionStore, request?: GetSupportedCommandsRequest): Promise<SupportedSlashCommand[]> {
  const sessionId = typeof request?.sessionId === "string" && request.sessionId.length > 0 ? request.sessionId : undefined;
  const session = sessionId ? store.getSession(sessionId) : null;
  const cwd = request?.cwd ?? session?.cwd ?? os.homedir();

  if (session?.slashCommands?.length) {
    return Promise.resolve(dedupeAndSort(session.slashCommands.map((name) => ({ name, description: name }))));
  }

  const cached = commandCache.get(cwd);
  if (cached) return cached;
  const next = getCommandsFromTemporaryQuery(cwd)
    .then(dedupeAndSort)
    .catch(() => []);
  commandCache.set(cwd, next);
  return next;
}

function dedupeAndSort(commands: SupportedSlashCommand[]): SupportedSlashCommand[] {
  const seen = new Set<string>();
  const normalized = commands
    .filter((command) => {
      if (!command.name || seen.has(command.name)) return false;
      seen.add(command.name);
      return true;
    })
    .map((command) => ({
      name: command.name,
      description: command.description,
      argumentHint: command.argumentHint,
      aliases: command.aliases,
      scope: command.scope,
    }));

  if (!seen.has("color")) {
    normalized.push({
      name: "color",
      description: "Set this session's prompt-box glow color",
      argumentHint: `<${colorNames.join("|")}|default>`,
    });
  }

  const usageAliases = ["stats", "cost"];
  const withoutUsageAliases = normalized.filter((command) => !usageAliases.includes(command.name));
  const usage = withoutUsageAliases.find((command) => command.name === "usage");
  if (usage) usage.aliases = Array.from(new Set([...(usage.aliases ?? []), ...usageAliases]));
  else withoutUsageAliases.push({ name: "usage", description: "Show your Claude Code usage", aliases: [...usageAliases] });

  return withoutUsageAliases.sort((left, right) => left.name.localeCompare(right.name));
}

function getCommandsFromTemporaryQuery(cwd: string): Promise<SupportedSlashCommand[]> {
  const executable = defaultClaudeExecutable();
  const args = ["--print", "--output-format", "stream-json", "--input-format", "text", "--verbose", "--bare", "/help"];
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcessWithoutNullStreams | null = null;
    const finish = (commands: SupportedSlashCommand[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill("SIGTERM");
      } catch {
        // The temporary query may already have exited.
      }
      resolve(commands);
    };
    const timer = setTimeout(() => finish([]), temporaryQueryTimeoutMs);

    try {
      child = spawnClaude(executable, args, cwd);
    } catch {
      finish([]);
      return;
    }

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      const event = parseJsonLine(line);
      if (event?.type !== "system" || event.subtype !== "init" || !Array.isArray(event.slash_commands)) return;
      finish(event.slash_commands.filter((name): name is string => typeof name === "string" && name.length > 0).map((name) => ({ name, description: name })));
    });
    child.on("error", () => finish([]));
    child.on("close", () => {
      stdout.close();
      finish([]);
    });
  });
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
