import type { App } from "electron";
import path from "node:path";
import { CLAUDE_DEEP_LINK_PROTOCOLS } from "./deepLinks";

/**
 * Official residual:
 *   DJn() → [IJn(Gpe)] with Gpe="claude:" → ["claude"]
 *   Urr(): setAsDefaultProtocolClient for each scheme (unless disableDeepLinks)
 *   LJn: unpackaged → [execPath, [resolved entry script]]
 *
 * Claiming "claude" stops Launch Services from preferring a stale/broken
 * handler (e.g. Deepseek bundle) for login magic-link callbacks.
 */
export function claimClaudeProtocolClients(app: App): void {
  // Residual DJn currently registers only "claude" (not nest variants).
  const schemes = ["claude"];

  const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const unpackagedArgs =
    !app.isPackaged && entryScript
      ? { execPath: process.execPath, args: [entryScript] as string[] }
      : null;

  for (const scheme of schemes) {
    try {
      if (unpackagedArgs) {
        app.setAsDefaultProtocolClient(scheme, unpackagedArgs.execPath, unpackagedArgs.args);
      } else {
        app.setAsDefaultProtocolClient(scheme);
      }
    } catch (error) {
      console.warn(`[claudeURLHandler] setAsDefaultProtocolClient(${scheme}) failed`, error);
    }
  }

  // Nest protocol names exist in residual zQe list for parse/isClaudeDeepLink only.
  // Keep a soft claim for product parity when running nested builds.
  for (const protocol of CLAUDE_DEEP_LINK_PROTOCOLS) {
    const scheme = protocol.endsWith(":") ? protocol.slice(0, -1) : protocol;
    if (scheme === "claude") continue;
    // Do not force-claim nest variants as default OS handlers for 1p login path.
  }
}
