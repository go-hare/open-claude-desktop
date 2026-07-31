/**
 * CLI `--mcp-config` wire residual (claude-code main.tsx → parseMcpConfig):
 * McpJsonConfigSchema = `{ mcpServers: Record<name, serverConfig> }`.
 * Bare server maps fail with:
 *   Invalid MCP configuration:
 *   mcpServers: Does not adhere to MCP server configuration schema
 */

/**
 * Normalize caller payloads (bare server map or already-wrapped) into a
 * server-name → config map for merge.
 */
export function asMcpServerMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const nested = record.mcpServers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>) };
  }
  return { ...record };
}

/** CLI-accepted JSON object for `--mcp-config`. */
export function toCliMcpConfigWire(value: unknown): { mcpServers: Record<string, unknown> } | null {
  const servers = asMcpServerMap(value);
  if (Object.keys(servers).length === 0) return null;
  return { mcpServers: servers };
}
