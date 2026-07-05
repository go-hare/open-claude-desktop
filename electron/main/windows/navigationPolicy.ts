import { shell, type BrowserWindow, type WebContents } from "electron";

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
  const url = new URL(rawUrl);
  if (isInternalNavigationUrl(url)) return true;

  const openExternal = options.openExternal ?? true;
  if (!defaultNavigationPolicy.allowedExternalProtocols.has(url.protocol)) return false;
  if (!openExternal) return false;

  void openExternalUrl(url, options.owner);
  return false;
}

export function installNavigationGuards(webContents: WebContents, owner?: BrowserWindow): void {
  webContents.on("will-navigate", (event, url) => {
    if (!handleNavigationUrl(url, { owner })) event.preventDefault();
  });

  webContents.on("will-redirect", (event, url) => {
    if (!handleNavigationUrl(url, { openExternal: false, owner })) event.preventDefault();
  });

  webContents.setWindowOpenHandler(({ url }) => {
    return handleNavigationUrl(url, { owner }) ? { action: "allow" } : { action: "deny" };
  });
}
