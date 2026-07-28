/**
 * Product bridge so Local Code CLI spawn can reach Launch + PreviewView
 * managers owned by featureHandlers (official InternalMcp host residual).
 *
 * Official: InternalMcpServerManager holds handleToolCall closures over ao /
 * preview view map. Product: register once at featureHandlers boot.
 */
import type { ClaudePreviewMcpHost } from "./claudePreviewMcpServer";

let registeredHost: ClaudePreviewMcpHost | null = null;
/** Cached serializable CLI mcpServers entry after host HTTP bridge is up. */
let cachedCliMcpConfig: Record<string, unknown> | null = null;
/** Last Code session cwd for preview_start / iue residual (sessionCwd). */
let lastCodeSessionCwd = "";

export function registerClaudePreviewMcpHost(
  host: ClaudePreviewMcpHost | null,
): void {
  registeredHost = host;
  if (!host) cachedCliMcpConfig = null;
}

export function getClaudePreviewMcpHost(): ClaudePreviewMcpHost | null {
  return registeredHost;
}

export function setClaudePreviewCliMcpConfigCache(
  config: Record<string, unknown> | null,
): void {
  cachedCliMcpConfig = config;
}

/**
 * Sync read for claudeCliRunner buildClaudeArgs (spawn is sync today).
 * Populated when featureHandlers boots the host HTTP bridge.
 */
export function getClaudePreviewCliMcpConfigCache(): Record<
  string,
  unknown
> | null {
  return cachedCliMcpConfig;
}

/** Official handleToolCall sessionCwd residual — updated on each Code turn. */
export function setClaudePreviewSessionCwd(cwd: string | undefined): void {
  if (typeof cwd === "string" && cwd.trim()) lastCodeSessionCwd = cwd.trim();
}

export function getClaudePreviewSessionCwd(): string {
  return lastCodeSessionCwd || process.cwd();
}
