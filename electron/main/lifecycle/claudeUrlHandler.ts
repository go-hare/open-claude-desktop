import type { WebContents } from "electron";
import { anthropicOriginUrl } from "../windows/routeMode";
import { isClaudeDeepLink } from "./deepLinks";

/**
 * Official residual (app.asar Z8 / claudeURLHandler):
 *
 * Fr.MagicLink:
 *   claude://claude.ai/magic-link?anon_id=…#nonce:encodedEmail
 *   → mainView.loadURL(https://claude.ai/magic-link#nonce:encodedEmail)
 *   + optional cookie _cross_domain_anonymous_id from anon_id
 *
 * qQe.GoogleAuth (Zd.Login):
 *   claude://login/google-auth?code=…&anon_id=…
 *   → webContents.send("googleAuthCode", { code })
 *   + optional anon cookie
 *
 * Fr.SSOCallback:
 *   claude://claude.ai/sso-callback?…&anon_id=…
 *   → loadURL(https://claude.ai/sso-callback?… without anon_id)
 *
 * Login SPA (OAuthCodeSuccessRoute) sets window.location.href = claude://… after
 * "Sign in complete". Without in-process handling + protocol claim, Launch Services
 * opens a stale handler → Finder "找不到该文件".
 */

const deliveredLoginCallbacks = new Set<string>();

/** Official Qj residual — open-url before mainView is ready. */
let pendingOpenUrl: string | null = null;

export type ClaudeUrlHandleResult = {
  handled: boolean;
  kind?: "magic-link" | "google-auth" | "sso-callback" | "other";
};

function parseClaudeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Official Nee residual — ignore repeat delivery of the same login callback URL.
 * Returns true when this delivery should be dropped.
 */
function isDuplicateLoginCallback(raw: string): boolean {
  if (deliveredLoginCallbacks.has(raw)) return true;
  deliveredLoginCallbacks.add(raw);
  return false;
}

function setAnonCookieThen(
  webContents: WebContents,
  anonId: string | null,
  next: () => void,
): void {
  if (!anonId) {
    next();
    return;
  }
  const origin = anthropicOriginUrl();
  void webContents.session.cookies
    .set({
      url: origin,
      name: "_cross_domain_anonymous_id",
      value: anonId,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    })
    .then(next, next);
}

function loadMagicLinkOnMainView(
  webContents: WebContents,
  hashBody: string,
  anonId: string | null,
): void {
  const origin = anthropicOriginUrl();
  // Official: new URL(Fr.MagicLink, It()) + _.hash = `${f}:${p}`
  const target = new URL("magic-link", origin.endsWith("/") ? origin : `${origin}/`);
  // hashBody is "nonce:encodedEmail" (no leading #) — URL.hash setter adds #.
  target.hash = hashBody;

  const load = () => {
    if (webContents.isDestroyed()) return;
    console.info("[claudeURLHandler] magic_link load", target.toString());
    void webContents.loadURL(target.toString()).catch((error) => {
      console.error("[claudeURLHandler] magic_link load failed", error);
    });
  };

  setAnonCookieThen(webContents, anonId, load);
}

function dispatchGoogleAuthCode(
  webContents: WebContents,
  code: string,
  anonId: string | null,
): void {
  const send = () => {
    if (webContents.isDestroyed()) return;
    // Official cme.googleAuthCode + preload claudeAppBindings.registerBinding
    console.info("[claudeURLHandler] googleAuthCode dispatch");
    webContents.send("googleAuthCode", { code });
  };
  setAnonCookieThen(webContents, anonId, send);
}

function loadSsoCallbackOnMainView(
  webContents: WebContents,
  rawUrl: URL,
  anonId: string | null,
): void {
  const origin = anthropicOriginUrl();
  const target = new URL("/sso-callback", origin.endsWith("/") ? origin : `${origin}/`);
  // Official: f.search = i.search; f.searchParams.delete("anon_id")
  target.search = rawUrl.search;
  target.searchParams.delete("anon_id");

  const load = () => {
    if (webContents.isDestroyed()) return;
    console.info("[claudeURLHandler] sso_callback load", target.toString());
    void webContents.loadURL(target.toString()).catch((error) => {
      console.error("[claudeURLHandler] sso_callback load failed", error);
    });
  };

  setAnonCookieThen(webContents, anonId, load);
}

/**
 * Parse magic-link hash residual.
 * SPA MagicLinkRoute: hash.slice(1).split(":") → [nonce, encodedEmail]
 * Official Z8: i.hash.split(":") length must be 2 (first piece may include leading #).
 */
export function parseMagicLinkHash(hash: string): { nonce: string; encodedEmail: string } | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  const [nonce, encodedEmail] = parts;
  if (!nonce || !encodedEmail) return null;
  return { nonce, encodedEmail };
}

/**
 * Official Z8 residual for login-related claude:// URLs.
 * Returns handled=true when caller must not openExternal / bridge-duplicate.
 */
export function handleClaudeDeepLink(
  rawUrl: string,
  webContents: WebContents | null | undefined,
): ClaudeUrlHandleResult {
  if (!rawUrl || !isClaudeDeepLink(rawUrl)) {
    return { handled: false };
  }
  if (!webContents || webContents.isDestroyed()) {
    return { handled: false };
  }

  const url = parseClaudeUrl(rawUrl);
  if (!url) return { handled: false };

  const host = (url.hostname || url.host || "").toLowerCase();
  // Official: const [l,u]=i.pathname.split("/"); switch(u)  — leading slash empty
  const pathParts = url.pathname.split("/").filter(Boolean);
  const pathSeg = (pathParts[0] ?? "").toLowerCase();

  // Zd.Login + qQe.GoogleAuth: claude://login/google-auth?code=
  if (host === "login" && (pathSeg === "google-auth" || url.pathname === "/google-auth")) {
    if (isDuplicateLoginCallback(rawUrl)) {
      return { handled: true, kind: "google-auth" };
    }
    const code = url.searchParams.get("code");
    if (!code) {
      console.warn("[claudeURLHandler] google_auth missing code");
      return { handled: true, kind: "google-auth" };
    }
    const anonId = url.searchParams.get("anon_id");
    dispatchGoogleAuthCode(webContents, code, anonId);
    return { handled: true, kind: "google-auth" };
  }

  // Zd.ClaudeAI paths
  if (host === "claude.ai") {
    if (pathSeg === "magic-link") {
      if (isDuplicateLoginCallback(rawUrl)) {
        return { handled: true, kind: "magic-link" };
      }
      const parsed = parseMagicLinkHash(url.hash);
      if (!parsed) {
        console.warn("[claudeURLHandler] magic_link malformed hash", url.hash);
        return { handled: true, kind: "magic-link" };
      }
      const anonId = url.searchParams.get("anon_id");
      loadMagicLinkOnMainView(
        webContents,
        `${parsed.nonce}:${parsed.encodedEmail}`,
        anonId,
      );
      return { handled: true, kind: "magic-link" };
    }

    if (pathSeg === "sso-callback") {
      // Official: only exact /sso-callback (not platform-suffixed)
      if (url.pathname !== "/sso-callback" && url.pathname !== "sso-callback") {
        console.info("[claudeURLHandler] ignoring platform-suffixed SSO callback", url.pathname);
        return { handled: true, kind: "sso-callback" };
      }
      if (isDuplicateLoginCallback(rawUrl)) {
        return { handled: true, kind: "sso-callback" };
      }
      const anonId = url.searchParams.get("anon_id");
      loadSsoCallbackOnMainView(webContents, url, anonId);
      return { handled: true, kind: "sso-callback" };
    }
  }

  // Other claude:// routes: not fully residual-ported here — leave to bridge dispatch.
  return { handled: false, kind: "other" };
}

/**
 * Official open-url residual: queue when mainView is not yet created.
 */
export function queuePendingClaudeOpenUrl(rawUrl: string): void {
  if (!rawUrl || !isClaudeDeepLink(rawUrl)) return;
  pendingOpenUrl = rawUrl;
}

export function takePendingClaudeOpenUrl(): string | null {
  const next = pendingOpenUrl;
  pendingOpenUrl = null;
  return next;
}

/** Test-only */
export function resetClaudeUrlHandlerForTests(): void {
  deliveredLoginCallbacks.clear();
  pendingOpenUrl = null;
}
