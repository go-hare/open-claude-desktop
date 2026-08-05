/**
 * Official Ob residual (connector-favicons / artifact-sandbox / mcp-registry):
 * When Ti().disableNonessentialServices === true, block renderer fetches that
 * only serve nonessential UX (Google favicon proxies, etc.).
 *
 * data-official-source: app.asar Ob / mZt / connector-favicons
 *
 * Product installs a defaultSession onBeforeRequest filter only for known
 * nonessential hosts/paths — never invents a full firewall graph.
 */
import { session } from "electron";
import { isEnterpriseNonessentialServicesDisabled } from "../coworkHostLoop/coworkEnterpriseConfig";

/** Official v9t + G9t residual — connector favicon hosts. */
export const CONNECTOR_FAVICON_HOSTS = [
  "www.google.com",
  "gstatic.com",
  "t0.gstatic.com",
  "t1.gstatic.com",
  "t2.gstatic.com",
  "t3.gstatic.com",
] as const;

function isConnectorFaviconUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    if (host === "www.google.com" && path.startsWith("/s2/favicons")) {
      return true;
    }
    if (
      (host === "gstatic.com" || host.endsWith(".gstatic.com")) &&
      path.includes("faviconV2")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

let installed = false;

/**
 * Official residual — gate connector favicon fetches when nonessential disabled.
 * Safe to call multiple times (idempotent).
 */
export function installEnterpriseNonessentialNetworkGate(): void {
  if (installed) return;
  installed = true;
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (
      isEnterpriseNonessentialServicesDisabled() &&
      isConnectorFaviconUrl(details.url)
    ) {
      callback({ cancel: true });
      return;
    }
    callback({});
  });
}

export function isConnectorFaviconUrlForTests(url: string): boolean {
  return isConnectorFaviconUrl(url);
}
