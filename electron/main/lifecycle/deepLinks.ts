export const CLAUDE_DEEP_LINK_PROTOCOLS = [
  "claude:",
  "claude-dev:",
  "claude-nest:",
  "claude-nest-dev:",
  "claude-nest-prod:",
] as const;

export type LaunchTarget = {
  deepLink?: string;
  extensionPath?: string;
  filePaths: string[];
};

export type FileExists = (filePath: string) => boolean;

export function isClaudeDeepLink(value: string): boolean {
  return CLAUDE_DEEP_LINK_PROTOCOLS.some((protocol) => value.startsWith(protocol));
}

export function isDesktopExtensionPackage(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.endsWith(".dxt") || lower.endsWith(".mcpb");
}

function isOptionArg(value: string): boolean {
  return value.startsWith("-");
}

/**
 * Mirrors original `Zgr(argv)` behavior for supported launch targets:
 * - skip Electron/CLI switches;
 * - prefer protocol URLs as deep links;
 * - classify `.dxt` / `.mcpb` extension package paths;
 * - collect ordinary existing file paths as file-drop payloads.
 */
export function extractLaunchTarget(argv: string[], fileExists: FileExists = () => false): LaunchTarget {
  const target: LaunchTarget = { filePaths: [] };

  for (const arg of argv.slice(1)) {
    if (!arg || isOptionArg(arg)) continue;

    if (isClaudeDeepLink(arg)) {
      target.deepLink ??= arg;
      continue;
    }

    if (isDesktopExtensionPackage(arg)) {
      target.extensionPath ??= arg;
      continue;
    }

    if (fileExists(arg)) {
      target.filePaths.push(arg);
      continue;
    }

    target.deepLink ??= arg;
  }

  return target;
}
