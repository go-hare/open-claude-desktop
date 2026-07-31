import type { BrowserWindow, WebContents } from "electron";
import { shell } from "electron";
import { handleClaudeDeepLink } from "../../lifecycle/claudeUrlHandler";
import { anthropicOriginUrl } from "../../windows/routeMode";

/**
 * Official residual (app.asar ZYt / doAuthInBrowser):
 *   1. https only
 *   2. AZt: rewrite https://claude.ai/… → https://claude.com/cai/…
 *   3. If @ant/claude-native AuthRequest.isAvailable() + host is login residual:
 *        ASWebAuthenticationSession with callback scheme "claude"
 *        → h2A(callbackUrl) / claudeURLHandler (google-auth / magic-link)
 *   4. Else shell.openExternal(rewritten URL)
 *
 * Product previously only openExternal(claude.ai) — browser completes OAuth but
 * claude:// callback may not re-enter the same mainView session cleanly, and
 * DesktopApp Google button uses doAuthInBrowser for app-google-auth.
 */

const CLAUDE_AI_ORIGIN = "https://claude.ai";
const CLAUDE_CAI_ORIGIN = "https://claude.com/cai";

type AuthRequestResult = {
  callbackUrl?: string | null;
  error?: unknown;
};

type AuthRequestInstance = {
  start: (url: string, scheme: string, nativeWindowHandle: Buffer) => Promise<AuthRequestResult>;
  cancel: () => void;
};

type AuthRequestCtor = {
  new (): AuthRequestInstance;
  isAvailable: () => boolean;
};

type ClaudeNativeModule = {
  AuthRequest?: AuthRequestCtor;
};

let cachedNative: ClaudeNativeModule | null | undefined;
let activeAuthRequest: AuthRequestInstance | null = null;

export function maybeGetClaudeNative(): ClaudeNativeModule | null {
  if (cachedNative !== undefined) return cachedNative;
  try {
    // Official: require("@ant/claude-native")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedNative = require("@ant/claude-native") as ClaudeNativeModule;
  } catch (error) {
    console.error("[Auth] Failed to load Claude Native", error);
    cachedNative = null;
  }
  return cachedNative;
}

/** Official AZt residual */
export function rewriteClaudeAiAuthUrl(url: string): string {
  if (url.startsWith(`${CLAUDE_AI_ORIGIN}/`)) {
    return `${CLAUDE_CAI_ORIGIN}${url.slice(CLAUDE_AI_ORIGIN.length)}`;
  }
  if (url === CLAUDE_AI_ORIGIN) return `${CLAUDE_CAI_ORIGIN}/`;
  return url;
}

/** Official GQ residual — host matches anthropic origin (.ai ↔ .com). */
export function isAnthropicProductHost(host: string): boolean {
  let expected: string;
  try {
    expected = new URL(anthropicOriginUrl()).host;
  } catch {
    expected = "claude.ai";
  }
  if (host === expected) return true;
  if (expected.endsWith(".ai")) {
    return host === expected.replace(/\.ai$/, ".com");
  }
  if (expected.endsWith(".com")) {
    return host === expected.replace(/\.com$/, ".ai");
  }
  return false;
}

/** Official Dai residual — URL eligible for ASWebAuth. */
export function isAsWebAuthEligibleUrl(url: URL): boolean {
  if (isAnthropicProductHost(url.host) && url.pathname.startsWith("/login/")) return true;
  if (url.host === "api.workos.com" && url.pathname.startsWith("/sso/")) return true;
  return false;
}

async function openExternalAuthUrl(url: string): Promise<void> {
  try {
    await shell.openExternal(url);
  } catch (error) {
    console.error("[Auth] Failed to open URL externally", { url, error });
  }
}

function raiseOwnerWindow(owner?: BrowserWindow | null): void {
  if (!owner || owner.isDestroyed()) return;
  if (!owner.isVisible()) owner.show();
  if (owner.isMinimized()) owner.restore();
  owner.moveTop();
  owner.focus();
}

function cancelActiveAuthRequest(): void {
  if (!activeAuthRequest) return;
  try {
    activeAuthRequest.cancel();
  } catch {
    /* ignore */
  }
  activeAuthRequest = null;
}

/**
 * Official doAuthInBrowser residual (ZYt.Auth):
 *   https only → AZt rewrite → if AuthRequest.isAvailable + owner + Dai(url)
 *     cancel previous RR → start(rewritten, "claude", nativeHandle)
 *     start throw → openExternal fallback
 *     callbackUrl → h2A / claudeURLHandler
 *     error (cancel/fail) → toast "Failed to login, it may have been cancelled" (no openExternal)
 *   else openExternal(rewritten)
 *
 * Returns true when a browser/ASWeb session was started (not whether login succeeded).
 */
export async function doAuthInBrowserResidual(
  rawUrl: string,
  options: {
    ownerWindow?: BrowserWindow | null;
    webContents?: WebContents | null;
    /**
     * Official foA residual for asweb cancel/fail.
     * message = "Failed to login, it may have been cancelled", toastType = "error".
     */
    showAuthErrorToast?: (message: string, toastType: "error" | "success", opts?: { messageForLogging?: string }) => void;
  } = {},
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.warn("[Auth] Rejecting invalid auth URL");
    return false;
  }
  if (parsed.protocol !== "https:") {
    console.warn("[Auth] Rejecting non-https auth URL:", parsed.protocol);
    return false;
  }

  const rewritten = rewriteClaudeAiAuthUrl(rawUrl);
  const native = maybeGetClaudeNative();
  const AuthRequest = native?.AuthRequest;
  const owner = options.ownerWindow;
  const canAsWeb =
    Boolean(AuthRequest?.isAvailable?.()) &&
    Boolean(owner) &&
    !owner!.isDestroyed() &&
    isAsWebAuthEligibleUrl(parsed);

  if (canAsWeb && AuthRequest) {
    console.info("[Auth] Starting ASWebAuth for:", parsed.pathname);
    cancelActiveAuthRequest();
    const request = new AuthRequest();
    activeAuthRequest = request;
    try {
      const handle = owner!.getNativeWindowHandle();
      // Official: scheme = xiA.split(":")[0] where xiA = "claude:"
      const result = await request.start(rewritten, "claude", handle);
      if (activeAuthRequest === request) activeAuthRequest = null;
      console.info("[Auth] ASWebAuth completed:", {
        success: Boolean(result?.callbackUrl),
        error: result?.error ?? null,
      });
      if (result?.callbackUrl) {
        const wc = options.webContents;
        if (wc && !wc.isDestroyed()) {
          handleClaudeDeepLink(result.callbackUrl, wc);
        } else {
          console.warn("[Auth] ASWebAuth callback without webContents", result.callbackUrl.slice(0, 120));
        }
        // open-url residual always raises mainWindow after login callback delivery
        raiseOwnerWindow(owner);
        return true;
      }
      if (result?.error) {
        // Official: completed-with-error → toast only (not openExternal).
        console.warn("[Auth] ASWebAuth login failed/cancelled", result.error);
        options.showAuthErrorToast?.(
          "Failed to login, it may have been cancelled",
          "error",
          { messageForLogging: "asweb_auth_login_failed" },
        );
      }
      return true;
    } catch (error) {
      // Official: start throw only → fall back to system browser.
      console.error("[Auth] ASWebAuth failed to start, falling back to system browser:", error);
      if (activeAuthRequest === request) activeAuthRequest = null;
      await openExternalAuthUrl(rewritten);
      return true;
    }
  }

  console.info("[Auth] Using system browser for:", parsed.pathname);
  await openExternalAuthUrl(rewritten);
  return true;
}

/** Test-only */
export function resetDoAuthInBrowserResidualForTests(): void {
  cachedNative = undefined;
  activeAuthRequest = null;
}
