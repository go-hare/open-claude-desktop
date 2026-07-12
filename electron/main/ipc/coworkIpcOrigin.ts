import { app, type IpcMainInvokeEvent } from "electron";

const productionHosts = new Set([
  "claude.ai",
  "preview.claude.ai",
  "claude.com",
  "preview.claude.com",
]);

export function isAllowedCoworkRendererUrl(
  value: string,
  allowDeveloperOrigins = !(app?.isPackaged ?? false),
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "app:" && url.host === "localhost") return true;
  if (url.protocol === "https:" && productionHosts.has(url.hostname)) return true;
  if (!allowDeveloperOrigins) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  return url.hostname === "localhost" || url.hostname.endsWith(".ant.dev");
}

export function assertCoworkIpcOrigin(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null || !isAllowedCoworkRendererUrl(frame.url)) {
    throw new Error("Unauthorized LocalAgentModeSessions IPC origin");
  }
}
