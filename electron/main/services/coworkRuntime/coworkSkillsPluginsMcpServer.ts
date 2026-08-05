/**
 * Official alwaysLoad MCP servers:
 *   Q9e = "skills"  → list_skills, suggest_skills  (Kxi / qxi reverse-RPC)
 *   B9e = "plugins" → list_plugins, search_plugins (Qde / $xi reverse-RPC)
 * suggest_plugin_install is pure render from tool args (no reverse-RPC) — omitted here.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { CoworkVmPathContext } from "../coworkSessions/coworkVmPathTranslation";
import {
  listInstalledCoworkPlugins,
  searchCoworkPlugins,
} from "./coworkPluginSearchBridge";
import {
  resolveCoworkSlashMenuSkills,
  searchCoworkAddableSkills,
  type CoworkSlashSkill,
} from "./coworkSkillsSlashBridge";
import { isEnterpriseNonessentialServicesDisabled } from "../coworkHostLoop/coworkEnterpriseConfig";
import { createCoworkMcpRegistryServerConfig } from "./coworkMcpRegistryServer";
import { wrapLocalMcpToolHandler } from "./coworkLocalMcpPathTranslate";
import {
  createCoworkComputerUseMcpServerConfig,
  type CoworkComputerUseMcpOptions,
} from "./coworkComputerUseMcpServer";

export type CoworkMcpPathContextResolver = () =>
  | CoworkVmPathContext
  | null
  | undefined;

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function mapSkillForSuggest(skill: CoworkSlashSkill) {
  return {
    name: skill.name,
    description: skill.description ?? "",
    skill_id: skill.skillId,
    is_user_created: skill.isUserCreated,
  };
}

export function createCoworkSkillsMcpServerConfig(
  sessionId: string,
  resolvePathContext?: CoworkMcpPathContextResolver,
) {
  const pathCtx = resolvePathContext ?? (() => null);
  return createSdkMcpServer({
    alwaysLoad: true,
    name: "skills",
    tools: [
      tool(
        "list_skills",
        "Render the user's installed slash-menu skills as an interactive widget with Try it buttons. Use when the user asks what skills they have.",
        {
          skill_names: z.array(z.string()).optional(),
          keywords: z.array(z.string()).optional(),
          context_label: z.string().optional(),
        },
        // Official LocalMcp createSdkServer: XL args / DeA content when pathCtx set.
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const skillNames = Array.isArray(args.skill_names)
            ? args.skill_names
            : undefined;
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const context_label =
            typeof args.context_label === "string" ? args.context_label : undefined;
          const [resolved, installedPluginsJson] = await Promise.all([
            resolveCoworkSlashMenuSkills(sessionId, skillNames, keywords),
            listInstalledCoworkPlugins(sessionId, undefined),
          ]);
          let installedPluginNames: string[] = [];
          try {
            const parsed = JSON.parse(installedPluginsJson) as {
              results?: Array<{ name?: string }>;
            };
            installedPluginNames = (parsed.results ?? [])
              .map((p) => p.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0);
          } catch {
            installedPluginNames = [];
          }
          let note: string;
          if (resolved.length > 0) {
            note =
              "Skills widget rendered above with the listed skills. Any lead-in goes before this call; skip re-listing them in text.";
          } else if (installedPluginNames.length > 0) {
            note = `No slash-menu skills matched the requested names — the widget did not render. The user has these plugins installed: ${installedPluginNames.join(", ")}. Call list_skills again with no skill_names to surface their skills.`;
          } else {
            note =
              "No installed skills matched — the widget did not render. Call suggest_skills to recommend skills the user can add.";
          }
          return textResult({
            resolved_skills: resolved.map((s) => ({
              name: s.name,
              description: s.description ?? "",
              argumentHint: s.argumentHint,
            })),
            context_label,
            note,
          });
        }),
      ),
      tool(
        "suggest_skills",
        "Render standalone skills the user can add as an interactive widget with Add buttons. For skills inside uninstalled plugins, also call search_plugins.",
        {
          keywords: z.array(z.string()).optional(),
          context_label: z.string().optional(),
        },
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const context_label =
            typeof args.context_label === "string" ? args.context_label : undefined;
          const resolved = (await searchCoworkAddableSkills(sessionId, keywords))
            .filter((s) => !!s.name)
            .slice(0, 15)
            .map(mapSkillForSuggest);
          const note =
            resolved.length > 0
              ? "Skills widget rendered above with Add buttons. Skip re-listing in text. Now call search_plugins with the same keywords — if it returns relevant matches, render them via suggest_plugin_install so both cards stack."
              : "No addable standalone skills matched — the widget did not render. Now call search_plugins with the same keywords (relevant skills may live inside an uninstalled plugin).";
          return textResult({
            resolved_skills: resolved,
            context_label,
            note,
          });
        }),
      ),
    ],
  });
}

export function createCoworkPluginsMcpServerConfig(
  sessionId: string,
  resolvePathContext?: CoworkMcpPathContextResolver,
) {
  const pathCtx = resolvePathContext ?? (() => null);
  return createSdkMcpServer({
    alwaysLoad: true,
    name: "plugins",
    tools: [
      tool(
        "list_plugins",
        "Render the user's installed plugins as an interactive card. Call when the user asks what plugins they have.",
        {
          keywords: z.array(z.string()).optional(),
          context_label: z.string().optional(),
        },
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const context_label =
            typeof args.context_label === "string" ? args.context_label : undefined;
          const raw = await listInstalledCoworkPlugins(sessionId, keywords);
          let plugins: unknown[] = [];
          try {
            const parsed = JSON.parse(raw) as {
              results?: Array<Record<string, unknown>>;
            };
            plugins = (parsed.results ?? []).map((g) => ({
              pluginName: g.name,
              pluginId: g.id,
              description: g.description,
              skills: g.skills,
            }));
          } catch {
            plugins = [];
          }
          return textResult({
            contextLabel: context_label,
            plugins,
            note:
              plugins.length > 0
                ? "Plugin card rendered above. Any lead-in goes before this call; skip re-listing the plugins in text."
                : "No installed plugins matched — the card did not render.",
          });
        }),
      ),
      tool(
        "search_plugins",
        "Search for installable plugins that match the user's request. Do not use browser/web search for plugins.",
        {
          keywords: z.array(z.string()).optional(),
          userIntent: z.string().optional(),
          includeInstalled: z.boolean().optional(),
        },
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const userIntent =
            typeof args.userIntent === "string" ? args.userIntent : undefined;
          const includeInstalled =
            typeof args.includeInstalled === "boolean"
              ? args.includeInstalled
              : undefined;
          const text = await searchCoworkPlugins(
            sessionId,
            userIntent,
            keywords,
            undefined,
            includeInstalled,
          );
          return {
            content: [{ type: "text" as const, text }],
          };
        }),
      ),
    ],
  });
}

/**
 * Merge official mcp-registry + skills + plugins (+ computer-use residual gFi)
 * into session mcpServers.
 *
 * Official: `uoA() && t.push(await gFi(e))` — computer-use when platform supports.
 * Product: inject createCoworkComputerUseMcpServerConfig when options provided
 * (host-loop permission broker wired by runtime controller).
 *
 * Async so callers can `await aFi` before building CU tools (gFi residual).
 * Sync callers may still `void` / ignore the promise shape via await in createQuery.
 */
export async function withCoworkAlwaysLoadMcpServers(
  sessionId: string,
  existing: Record<string, unknown> | undefined,
  resolvePathContext?: CoworkMcpPathContextResolver,
  computerUse?: CoworkComputerUseMcpOptions | null,
): Promise<Record<string, unknown>> {
  // Official disableNonessentialServices residual: skip mcp-registry directory.
  const skipRegistry = isEnterpriseNonessentialServicesDisabled();
  const registry = skipRegistry
    ? null
    : createCoworkMcpRegistryServerConfig(sessionId, resolvePathContext);
  const skills = createCoworkSkillsMcpServerConfig(sessionId, resolvePathContext);
  const plugins = createCoworkPluginsMcpServerConfig(
    sessionId,
    resolvePathContext,
  );
  const out: Record<string, unknown> = {
    ...(existing ?? {}),
    ...(registry ? { "mcp-registry": registry } : {}),
    skills,
    plugins,
  };
  if (computerUse) {
    const cu = createCoworkComputerUseMcpServerConfig(computerUse);
    if (cu) out["computer-use"] = cu;
  }
  return out;
}

/**
 * Sync variant for unit tests / call sites that already resolved CU options.
 * Prefer `withCoworkAlwaysLoadMcpServers` (async) from createQuery residual.
 */
export function withCoworkAlwaysLoadMcpServersSync(
  sessionId: string,
  existing: Record<string, unknown> | undefined,
  resolvePathContext?: CoworkMcpPathContextResolver,
  computerUse?: CoworkComputerUseMcpOptions | null,
): Record<string, unknown> {
  // Same body — kept sync for tests that don't need aFi await.
  const skipRegistry = isEnterpriseNonessentialServicesDisabled();
  const registry = skipRegistry
    ? null
    : createCoworkMcpRegistryServerConfig(sessionId, resolvePathContext);
  const skills = createCoworkSkillsMcpServerConfig(sessionId, resolvePathContext);
  const plugins = createCoworkPluginsMcpServerConfig(
    sessionId,
    resolvePathContext,
  );
  const out: Record<string, unknown> = {
    ...(existing ?? {}),
    ...(registry ? { "mcp-registry": registry } : {}),
    skills,
    plugins,
  };
  if (computerUse) {
    const cu = createCoworkComputerUseMcpServerConfig(computerUse);
    if (cu) out["computer-use"] = cu;
  }
  return out;
}
