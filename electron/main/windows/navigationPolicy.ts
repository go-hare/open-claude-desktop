import { shell, type BrowserWindow, type WebContents } from "electron";
import { handleClaudeDeepLink } from "../lifecycle/claudeUrlHandler";
import { isClaudeDeepLink } from "../lifecycle/deepLinks";

export type NavigationPolicy = {
  allowedInternalOrigins: Set<string>;
  allowedInternalHosts: Set<string>;
  allowedExternalProtocols: Set<string>;
};

export const defaultNavigationPolicy: NavigationPolicy = {
  allowedInternalOrigins: new Set([
    "app://localhost",
    "https://claude.ai",
    "https://preview.claude.ai",
    "https://claude.com",
    "https://preview.claude.com",
  ]),
  allowedInternalHosts: new Set(["localhost", "127.0.0.1", "::1"]),
  allowedExternalProtocols: new Set(["http:", "https:", "mailto:", "tel:", "sms:", "ms-excel:", "ms-powerpoint:", "ms-word:"]),
};

function getOrigin(url: URL): string {
  return url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
}

export function isInternalNavigationUrl(url: URL, policy = defaultNavigationPolicy): boolean {
  return policy.allowedInternalOrigins.has(getOrigin(url)) || policy.allowedInternalHosts.has(url.hostname);
}

export async function openExternalUrl(url: URL, owner?: BrowserWindow): Promise<void> {
  if (url.protocol === "mailto:") {
    // Original app shows a confirmation dialog. Keep the seam explicit for the dialog service.
    await shell.openExternal(url.toString());
    return;
  }
  await shell.openExternal(url.toString());
}

export function handleNavigationUrl(rawUrl: string, options: { openExternal?: boolean; owner?: BrowserWindow } = {}): boolean {
  // claude:// must never fall through to shell.openExternal / Launch Services —
  // broken preferred handlers surface Finder "找不到该文件".
  if (isClaudeDeepLink(rawUrl)) return false;

  const url = new URL(rawUrl);
  if (isInternalNavigationUrl(url)) return true;

  const openExternal = options.openExternal ?? true;
  if (!defaultNavigationPolicy.allowedExternalProtocols.has(url.protocol)) return false;
  if (!openExternal) return false;

  void openExternalUrl(url, options.owner);
  return false;
}

function raiseOwner(owner?: BrowserWindow): void {
  if (!owner || owner.isDestroyed()) return;
  if (!owner.isVisible()) owner.show();
  if (owner.isMinimized()) owner.restore();
  owner.moveTop();
  owner.focus();
}

/**
 * Official residual: SPA login success does location.href = claude://…/magic-link#…
 * Intercept will-navigate / will-redirect in-process (Z8) so OS protocol client is
 * never invoked for in-app navigations.
 */
export function installNavigationGuards(webContents: WebContents, owner?: BrowserWindow): void {
  const interceptClaude = (event: { preventDefault: () => void }, url: string): boolean => {
    if (!isClaudeDeepLink(url)) return false;
    event.preventDefault();
    console.info("[claudeURLHandler] intercept navigate", url.slice(0, 160));
    handleClaudeDeepLink(url, webContents);
    raiseOwner(owner);
    return true;
  };

  webContents.on("will-navigate", (event, url) => {
    if (interceptClaude(event, url)) return;
    if (!handleNavigationUrl(url, { owner })) event.preventDefault();
  });

  webContents.on("will-redirect", (event, url) => {
    if (interceptClaude(event, url)) return;
    if (!handleNavigationUrl(url, { openExternal: false, owner })) event.preventDefault();
  });

  webContents.setWindowOpenHandler(({ url }) => {
    if (isClaudeDeepLink(url)) {
      handleClaudeDeepLink(url, webContents);
      raiseOwner(owner);
      return { action: "deny" };
    }
    return handleNavigationUrl(url, { owner }) ? { action: "allow" } : { action: "deny" };
  });
}
