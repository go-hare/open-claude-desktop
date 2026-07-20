/**
 * Official internal MCP server PoA "mcp-registry" (app.asar):
 * tools search_mcp_registry / suggest_connectors / list_connectors
 * handleToolCall → xxi / Hxi / Pxi (directory bridge).
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { CoworkVmPathContext } from "../coworkSessions/coworkVmPathTranslation";
import {
  listInstalledCoworkDirectoryServers,
  lookupCoworkDirectoryServers,
  searchCoworkDirectoryServers,
  type CoworkDirectoryServer,
} from "./coworkMcpDirectoryBridge";
import { wrapLocalMcpToolHandler } from "./coworkLocalMcpPathTranslate";

type CoworkMcpPathContextResolver = () =>
  | CoworkVmPathContext
  | null
  | undefined;

const keywordsSchema = { keywords: z.array(z.string()).optional() };
const searchSchema = { keywords: z.array(z.string()) };
const suggestSchema = {
  keywords: z.array(z.string()).optional(),
  uuids: z.array(z.string()).optional(),
};

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function mapSearchHit(server: CoworkDirectoryServer) {
  const toolNames = server.toolNames ?? [];
  const s = toolNames.slice(0, 8);
  const more = toolNames.length > s.length;
  return {
    description: server.oneLiner,
    directoryUuid: server.uuid,
    iconUrl: server.iconUrl,
    name: server.name,
    tools: more ? [...s, `+${toolNames.length - 8} more`] : s,
    url: server.url,
  };
}

function mapConnector(server: CoworkDirectoryServer) {
  return {
    connected: server.isConnected,
    description: server.oneLiner,
    directoryUuid: server.uuid,
    iconUrl: server.iconUrl,
    name: server.name,
    url: server.url,
  };
}

/**
 * Official handleToolCall for mcp-registry; sessionId comes from query factory context.
 * Path context enables official LocalMcp XL/DeA staging (no-op when null).
 */
export function createCoworkMcpRegistryServerConfig(
  sessionId: string,
  resolvePathContext?: CoworkMcpPathContextResolver,
) {
  const pathCtx = resolvePathContext ?? (() => null);
  return createSdkMcpServer({
    alwaysLoad: true,
    name: "mcp-registry",
    tools: [
      tool(
        "search_mcp_registry",
        "Search for available connectors in the MCP registry. Call this when connecting to a new MCP might help resolve the user query.",
        searchSchema,
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const keywords = Array.isArray(args.keywords) ? args.keywords : [];
          const hits = (await searchCoworkDirectoryServers(sessionId, keywords))
            .slice(0, 10)
            .map(mapSearchHit);
          return textResult({ results: hits, keywords });
        }),
      ),
      tool(
        "suggest_connectors",
        "Display connector suggestions to the user with Connect buttons. Call after search_mcp_registry for unconnected connectors, or on auth errors with server UUIDs.",
        suggestSchema,
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const uuids = Array.isArray(args.uuids) ? args.uuids : [];
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const connectors = (
            await lookupCoworkDirectoryServers(sessionId, uuids)
          ).map((s) => ({
            description: s.oneLiner,
            directoryUuid: s.uuid,
            iconUrl: s.iconUrl,
            name: s.name,
            url: s.url,
          }));
          return textResult({ connectors, keywords });
        }),
      ),
      tool(
        "list_connectors",
        "Render the user's installed connectors as an interactive card. Call when the user asks what connectors they have; pass keywords to filter.",
        keywordsSchema,
        wrapLocalMcpToolHandler(pathCtx, async (args) => {
          const keywords = Array.isArray(args.keywords) ? args.keywords : undefined;
          const connectors = (
            await listInstalledCoworkDirectoryServers(sessionId, keywords)
          ).map(mapConnector);
          return textResult({
            connectors,
            keywords,
            note:
              connectors.length > 0
                ? "Connector card rendered above. Any lead-in goes before this call; skip repeating the list."
                : "No installed connectors matched.",
          });
        }),
      ),
    ],
  });
}

/** Merge official mcp-registry into session mcpServers for the agent query. */
export function withCoworkMcpRegistryServers(
  sessionId: string,
  existing: Record<string, unknown> | undefined,
  resolvePathContext?: CoworkMcpPathContextResolver,
): Record<string, unknown> {
  const registry = createCoworkMcpRegistryServerConfig(
    sessionId,
    resolvePathContext,
  );
  return {
    ...(existing ?? {}),
    "mcp-registry": registry,
  };
}
