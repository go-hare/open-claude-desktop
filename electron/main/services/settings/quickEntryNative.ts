/**
 * Official native Quick Entry residual (app.asar index.js):
 *
 *   Y9i: if t2A() load @ant/claude-swift → nr, wire events, setLoggedIn, PwA, dit
 *   WX.setRecentChats(chats, activeChatId) → p5t/D5t → w5t/m5t →
 *     nr.quickAccess.overlay.setRecentChats / setActiveChatId
 *   H9i: nr.quickAccess.overlay.toggle()
 *   yst: if i2A() return OSe() ? (await H9i(), true) : false
 *   K9i: map prompt/images/filePaths → requestQuickWindowDismissWithPayload shape
 *
 * Official AUe / ion-dist residual keys for recent chats:
 *   { chatId: uuid, chatName: name } — NOT { uuid, name }.
 *
 * Product residual: only marks handled when real overlay.toggle ran.
 * Does not invent native success without load + toggle.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { session } from "electron";
import type { BrowserWindow, WebContents } from "electron";
import type { CoworkAccountContext } from "../coworkAccount/coworkAccountContext";
import {
  isNativeQuickEntryFeatureSupported,
} from "./nativeQuickEntryFeature";
import {
  getClaudeSwiftAddonCached,
  loadClaudeSwiftAddon,
  type ClaudeSwiftAddon,
  type ClaudeSwiftRecentChatItem,
} from "./claudeSwiftAddon";

const MAX_FILE_ATTACHMENT_BYTES = 30 * 1024 * 1024;
const DEFAULT_BASE_URL = "https://claude.ai";
/**
 * Official 3p Iai residual (app.asar):
 *   orgUuidOverride(){ return creds.organizationKey ?? Iai }
 *   Iai = "00000000-0000-4000-8000-000000000001"
 * dr() uses orgUuidOverride BEFORE lastActiveOrg cookie. 3p/dotClaude product
 * bootstrap synthesizes the same DEFAULT_ORG_UUID in custom3pApi.
 */
export const OFFICIAL_3P_DEFAULT_ORG_UUID =
  "00000000-0000-4000-8000-000000000001";
/** Official d7 residual: org cookie value must look like a UUID. */
const ORG_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuickEntrySubmitImage = {
  base64: string;
  mimeType: string;
  filename?: string;
};

export type QuickEntrySubmitPayload = {
  text: string;
  images: QuickEntrySubmitImage[];
  chatId?: string;
};

export type QuickEntryNativeDeps = {
  getMainWindow: () => BrowserWindow | null | undefined;
  getMainViewWebContents: () => WebContents | null | undefined;
  account: CoworkAccountContext;
  /** Dispatch official claude.web QuickEntry.onQuickEntrySubmit residual. */
  onSubmit: (payload: QuickEntrySubmitPayload) => void;
  /** Official navigateToChat residual — optional. */
  onNavigateToChat?: (chatId: string) => void;
  showMainWindow?: () => void;
  /** Optional locale for dit residual (dictation language). */
  getLocale?: () => string | null | undefined;
  /**
   * Official owe residual reads gi("quickEntryShortcut").
   * When "double-tap-option" (default SSA), wire optionDoubleTapped.
   */
  getQuickEntryShortcut?: () => unknown;
  /**
   * Official Ii()/deployment mode residual for or():
   *   3p Cai getMainWindowUrl → app://localhost
   *   1p → https://claude.ai
   * Product also maps dotClaude → 3p shell (same Jb base for PwA).
   */
  getDeploymentMode?: () => string | null | undefined;
};

let wired: ClaudeSwiftAddon | null = null;
let unsubscribeAccount: (() => void) | null = null;
let deps: QuickEntryNativeDeps | null = null;
let cookiesListenerAttached = false;

/** Official recent-chats / active-chat-id store residual (p5t / D5t). */
let recentChatsStore: ClaudeSwiftRecentChatItem[] = [];
let activeChatIdStore: string | null = null;

/**
 * Official OSe / hit residual (app.asar):
 *   function hit(){ const e=qa(); return e ? !e.isLoggedOut : false }
 * When account details are null → false (do not invent logged-in).
 * Explicit isLoggedOut:true blocks native share strip + recent chats.
 */
export function isQuickEntryLoggedIn(account: CoworkAccountContext): boolean {
  const details = account.getAccountDetails();
  if (!details) return false;
  return details.isLoggedOut !== true;
}

/**
 * Official AUe + ion-dist residual:
 *   chats.map(t => ({ chatId: t.uuid, chatName: t.name || "Untitled" }))
 * Accept already-normalized { chatId, chatName } or legacy { uuid, name }.
 */
export function normalizeRecentChatItems(raw: unknown): ClaudeSwiftRecentChatItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaudeSwiftRecentChatItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const chatId =
      typeof record.chatId === "string" && record.chatId.length > 0
        ? record.chatId
        : typeof record.uuid === "string" && record.uuid.length > 0
          ? record.uuid
          : null;
    if (!chatId) continue;
    const chatName =
      typeof record.chatName === "string" && record.chatName.length > 0
        ? record.chatName
        : typeof record.name === "string" && record.name.length > 0
          ? record.name
          : "Untitled";
    out.push({ chatId, chatName });
  }
  return out;
}

export function getRecentChatsStore(): ClaudeSwiftRecentChatItem[] {
  return recentChatsStore.slice();
}

export function getActiveChatIdStore(): string | null {
  return activeChatIdStore;
}

/**
 * Official setLoggedIn NAPI returns a Promise (Swift MainActor).
 * Await so QuickEntryCoordinator._loggedIn settles before overlay paint.
 */
async function syncLoggedIn(
  nr: ClaudeSwiftAddon,
  account: CoworkAccountContext,
): Promise<void> {
  try {
    const fn = nr.quickAccess?.overlay?.setLoggedIn;
    if (typeof fn !== "function") return;
    const result = fn.call(nr.quickAccess.overlay, isQuickEntryLoggedIn(account));
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
  } catch (error) {
    console.warn("[quickEntryNative] setLoggedIn failed", error);
  }
}

/**
 * Official w5t / m5t residual push into Swift overlay component.
 * Keys MUST be chatId / chatName (Swift RecentChatItem).
 */
/**
 * Official setRecentChats / setActiveChatId also return Promises.
 * Fire-and-await so Swift store is consistent before toggle (H9i residual order).
 */
export async function pushRecentChatsToOverlay(
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): Promise<void> {
  if (!nr?.quickAccess?.overlay) return;
  try {
    const setChats = nr.quickAccess.overlay.setRecentChats;
    if (typeof setChats === "function") {
      const r = setChats.call(nr.quickAccess.overlay, recentChatsStore);
      if (r && typeof (r as Promise<unknown>).then === "function") await r;
    }
  } catch (error) {
    console.warn("[quickEntryNative] setRecentChats failed", error);
  }
  try {
    const setActive = nr.quickAccess.overlay.setActiveChatId;
    if (typeof setActive === "function") {
      const r = setActive.call(nr.quickAccess.overlay, activeChatIdStore);
      if (r && typeof (r as Promise<unknown>).then === "function") await r;
    }
  } catch (error) {
    console.warn("[quickEntryNative] setActiveChatId failed", error);
  }
}

/**
 * Official WX.QuickEntry.setRecentChats(chats, activeChatId) residual:
 *   p5t(n); D5t(o); → subscribers feed Swift overlay.
 */
export function applyRecentChatsFromWeb(
  chats: unknown,
  activeChatId?: unknown,
): ClaudeSwiftRecentChatItem[] {
  recentChatsStore = normalizeRecentChatItems(chats);
  if (activeChatId === null || activeChatId === undefined) {
    activeChatIdStore = null;
  } else if (typeof activeChatId === "string") {
    activeChatIdStore = activeChatId.length > 0 ? activeChatId : null;
  }
  // Ignore non-string activeChatId (official schema: string | null).
  void pushRecentChatsToOverlay();
  return recentChatsStore;
}

/**
 * Official or() residual: Ii().getMainWindowUrl().
 *   3p Cai: always `app://localhost` (const Jb = `${KrA}://localhost`)
 *   1p Hai: https://claude.ai (or real main window origin)
 *
 * Product must NOT use CLAUDE_DESKTOP_MAIN_VIEW_URL (http://localhost:5176) as
 * dictation base — that is only the dev shell webview host. ClaudeAiSpeechSession
 * builds `api/ws/speech_to_text/voice_stream` on dictationBaseURL; vite has no
 * residual for that path. Official 3p PwA always passes app://localhost.
 */
export function isThirdPartyDeploymentMode(
  next: QuickEntryNativeDeps | null = deps,
): boolean {
  const mode =
    typeof next?.getDeploymentMode === "function"
      ? next.getDeploymentMode()
      : null;
  if (mode === "3p" || mode === "dotClaude") return true;

  // Fallback when deps omit mode: synthetic 3p/dotClaude identity.
  if (!next?.account) return false;
  try {
    const id = next.account.getIdentity();
    if (id?.organizationUuid === OFFICIAL_3P_DEFAULT_ORG_UUID) return true;
    if (
      typeof id?.accountUuid === "string"
      && id.accountUuid.startsWith("cowork_3p_")
    ) {
      return true;
    }
    const details = next.account.getAccountDetails();
    if (
      details
      && details.isLoggedOut !== true
      && typeof details.accountUuid === "string"
      && details.accountUuid.startsWith("cowork_3p_")
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function resolveBaseUrl(next: QuickEntryNativeDeps | null = deps): string {
  // Official 3p Cai: getMainWindowUrl() → app://localhost (never vite host).
  if (isThirdPartyDeploymentMode(next)) {
    return "app://localhost";
  }

  try {
    const url = next?.getMainViewWebContents?.()?.getURL?.();
    if (
      url
      && (url.startsWith("http://")
        || url.startsWith("https://")
        || url.startsWith("app://"))
    ) {
      const origin = new URL(url).origin;
      // Dev vite host is never official or() for speech credentials.
      if (
        origin.startsWith("http://localhost:")
        || origin.startsWith("http://127.0.0.1:")
      ) {
        // 1p unpackaged still uses DEFAULT (claude.ai), not vite.
      } else {
        return origin;
      }
    }
  } catch {
    /* ignore */
  }

  return DEFAULT_BASE_URL;
}

function decodeOrgUuid(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return ORG_UUID_RE.test(value) ? value : null;
}

/**
 * Official dr() residual (exact order):
 *   1. cached ok
 *   2. Ii().orgUuidOverride()  — 3p: creds.organizationKey ?? Iai
 *   3. cookies lastActiveOrg on or() URL (d7 UUID decode)
 *   4. else null
 *
 * Product: account identity / bootstrap = orgUuidOverride; cookie path same;
 * when logged-in without cookie/identity yet, Iai (3p default) so PwA can run
 * and ClaudeAiSpeechSession is not stuck on "Dictation not configured".
 */
export async function resolveDictationOrgUuid(
  next: QuickEntryNativeDeps | null = deps,
  baseUrl: string = resolveBaseUrl(next),
): Promise<string | null> {
  // (2) orgUuidOverride residual via account identity / bootstrap
  if (next?.account) {
    let identity = next.account.getIdentity();
    if (!identity?.organizationUuid) {
      try {
        identity = await next.account.waitForIdentity(1_500);
      } catch {
        identity = null;
      }
    }
    const fromIdentity = decodeOrgUuid(identity?.organizationUuid);
    if (fromIdentity) return fromIdentity;
  }

  // (3) lastActiveOrg cookie on main-window origin
  try {
    const orgCookies = await session.defaultSession.cookies.get({
      url: baseUrl,
      name: "lastActiveOrg",
    });
    for (const cookie of orgCookies) {
      const decoded = decodeOrgUuid(cookie.value);
      if (decoded) return decoded;
    }
    // Also scan path="/" cookies in case name filter differs by Electron version
    const all = await session.defaultSession.cookies.get({ url: baseUrl });
    for (const cookie of all) {
      if (cookie.name !== "lastActiveOrg") continue;
      const decoded = decodeOrgUuid(cookie.value);
      if (decoded) return decoded;
    }
  } catch {
    /* ignore cookie read */
  }

  // Official 3p orgUuidOverride never returns null — falls through to Iai.
  // 1p override is null and relies on cookie; only apply Iai when logged-in
  // (hit()) so logged-out 1p does not invent org credentials.
  if (next && isQuickEntryLoggedIn(next.account)) {
    return OFFICIAL_3P_DEFAULT_ORG_UUID;
  }
  return null;
}

/**
 * Official PwA residual (app.asar):
 *   org = await dr() — if !org return
 *   base = or() (main window URL origin)
 *   cookieHeader = session.cookies.get({url: base}).filter(path==="/").serialize
 *   nr.api.setCredentials(base, cookieHeader, org)
 *
 * Does not invent multi-host cookie merges. Org resolution matches dr()
 * (override / cookie / 3p Iai), not cookie-only.
 */
export async function configureSwiftApiCredentials(
  next: QuickEntryNativeDeps | null = deps,
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): Promise<boolean> {
  if (!nr?.api || typeof nr.api.setCredentials !== "function") {
    console.info("[quickEntryNative] PwA skip: no nr.api.setCredentials");
    return false;
  }
  try {
    const baseUrl = resolveBaseUrl(next);
    const orgUuid = await resolveDictationOrgUuid(next, baseUrl);
    // Official: if (!e) return; — no org → no setCredentials → Dictation not configured
    if (!orgUuid) {
      console.info("[quickEntryNative] PwA skip: dr() org is null (no override/cookie/Iai)");
      return false;
    }
    const cookies = await session.defaultSession.cookies.get({ url: baseUrl });
    // Official: path === "/" only
    const header = cookies
      .filter((c) => c.path === "/" || c.path === undefined || c.path === "")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    nr.api.setCredentials(baseUrl, header, orgUuid);
    console.info("[quickEntryNative] PwA setCredentials", {
      baseUrl,
      orgUuid,
      cookieHeaderLen: header.length,
      cookieCount: cookies.filter((c) => c.path === "/" || !c.path).length,
    });
    return true;
  } catch (error) {
    console.error("[quickEntryNative] Failed to configure API credentials:", error);
    return false;
  }
}

/**
 * Official J9i residual — map app locale → dictation language code.
 */
export function mapDictationLanguageCode(locale: string): string {
  const A = locale.toLowerCase();
  const t: Record<string, string> = {
    bg: "bg",
    ca: "ca",
    zh: "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-tw": "zh-TW",
    "zh-hant": "zh-TW",
    "zh-hk": "zh-HK",
    cs: "cs",
    da: "da",
    "da-dk": "da",
    nl: "nl",
    "nl-be": "nl-BE",
    en: "en",
    "en-us": "en-US",
    "en-au": "en-AU",
    "en-gb": "en-GB",
    "en-nz": "en-NZ",
    "en-in": "en-IN",
    et: "et",
    fi: "fi",
    fr: "fr",
    "fr-ca": "fr",
    de: "de",
    "de-ch": "de-CH",
    el: "el",
    hi: "hi",
    hu: "hu",
    id: "id",
    it: "it",
    ja: "ja",
    ko: "ko",
    "ko-kr": "ko",
    lv: "lv",
    lt: "lt",
    ms: "ms",
    no: "no",
    pl: "pl",
    pt: "pt",
    "pt-br": "pt",
    "pt-pt": "pt",
    ro: "ro",
    ru: "ru",
    sk: "sk",
    es: "es",
    "es-419": "es",
    sv: "sv",
    "sv-se": "sv",
    th: "th",
    "th-th": "th",
    tr: "tr",
    uk: "uk",
    vi: "vi",
  };
  if (t[A]) return t[A];
  const i = A.split("-")[0] ?? "";
  return t[i] ? t[i] : "en";
}

/**
 * Official dit residual:
 *   if (nr) try { setLanguage(J9i(se().locale)) } catch log
 */
export function configureSwiftDictationLanguage(
  next: QuickEntryNativeDeps | null = deps,
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): void {
  if (!nr) return;
  try {
    const setLanguage = nr.quickAccess?.dictation?.setLanguage;
    if (typeof setLanguage !== "function") return;
    const locale = next?.getLocale?.();
    if (!locale || typeof locale !== "string") return;
    setLanguage.call(nr.quickAccess!.dictation, mapDictationLanguageCode(locale));
  } catch (error) {
    console.error("[quickEntryNative] Failed to configure dictation language:", error);
  }
}

function attachCookieListener(): void {
  if (cookiesListenerAttached) return;
  cookiesListenerAttached = true;
  try {
    // Official: cookies.on("changed") → lastActiveOrg → PwA()
    session.defaultSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
      if (removed) return;
      if (cookie?.name === "lastActiveOrg") {
        void configureSwiftApiCredentials();
      }
    });
  } catch (error) {
    console.warn("[quickEntryNative] cookies listener failed", error);
  }
}

async function mapNativeSubmit(raw: {
  prompt?: unknown;
  images?: unknown;
  filePaths?: unknown;
  chatId?: unknown;
}): Promise<QuickEntrySubmitPayload> {
  const text = typeof raw.prompt === "string" ? raw.prompt : "";
  const chatId = typeof raw.chatId === "string" ? raw.chatId : undefined;
  const images: QuickEntrySubmitImage[] = [];

  if (Array.isArray(raw.images)) {
    for (const item of raw.images) {
      if (typeof item === "string" && item.length > 0) {
        images.push({ base64: item, mimeType: "image/jpeg" });
      }
    }
  }

  if (Array.isArray(raw.filePaths)) {
    for (const entry of raw.filePaths) {
      if (typeof entry !== "string" || entry.length === 0) continue;
      try {
        const filePath = entry.startsWith("file:") ? fileURLToPath(entry) : entry;
        const stat = await fs.stat(filePath);
        if (stat.size > MAX_FILE_ATTACHMENT_BYTES) {
          console.warn(
            `[quickEntryNative] skip ${path.basename(filePath)}: ${(stat.size / 1024 / 1024).toFixed(1)} MB exceeds limit`,
          );
          continue;
        }
        const buf = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mimeType =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : "application/unknown";
        images.push({
          base64: buf.toString("base64"),
          mimeType,
          filename: path.basename(filePath),
        });
      } catch (error) {
        console.warn("[quickEntryNative] filePath read failed", entry, error);
      }
    }
  }

  return { text, images, chatId };
}

function wireEvents(nr: ClaudeSwiftAddon, next: QuickEntryNativeDeps): void {
  if (wired === nr) {
    deps = next;
    void syncLoggedIn(nr, next.account);
    void pushRecentChatsToOverlay(nr);
    void configureSwiftApiCredentials(next, nr);
    configureSwiftDictationLanguage(next, nr);
    return;
  }

  // Remove previous account subscription if rebinding.
  unsubscribeAccount?.();
  unsubscribeAccount = null;

  // Official Y9i: nr.on("quickEntrySubmitted", K9i)
  // K9i maps prompt/images/filePaths/chatId then requestQuickWindowDismissWithPayload(IKA).
  nr.on("quickEntrySubmitted", (payload: unknown) => {
    void (async () => {
      try {
        const record =
          typeof payload === "object" && payload !== null
            ? (payload as {
                prompt?: unknown;
                images?: unknown;
                filePaths?: unknown;
                chatId?: unknown;
              })
            : {};
        console.info("[quickEntryNative] quickEntrySubmitted (official K9i)", {
          promptLen: typeof record.prompt === "string" ? record.prompt.length : 0,
          images: Array.isArray(record.images) ? record.images.length : 0,
          filePaths: Array.isArray(record.filePaths) ? record.filePaths.length : 0,
          chatId: typeof record.chatId === "string" ? record.chatId : null,
          hasOnSubmit: typeof deps?.onSubmit === "function",
        });
        const mapped = await mapNativeSubmit(record);
        // Official IKA gate lives in onSubmit residual; K9i always forwards mapped payload.
        // Keep a minimal empty filter so we never invent a blank chat from a no-op event.
        const hasContent =
          (mapped.text && mapped.text.trim().length > 0) || mapped.images.length > 0;
        if (!hasContent) {
          console.info("[quickEntryNative] K9i empty payload — skip (no text/images)");
          return;
        }
        if (!deps?.onSubmit) {
          console.warn("[quickEntryNative] K9i: deps.onSubmit missing");
          return;
        }
        deps.onSubmit(mapped);
        deps.showMainWindow?.();
      } catch (error) {
        console.warn("[quickEntryNative] quickEntrySubmitted failed", error);
      }
    })();
  });

  nr.on("navigateToChat", (chatId: unknown) => {
    try {
      if (typeof chatId === "string" && chatId.length > 0) {
        deps?.onNavigateToChat?.(chatId);
        deps?.showMainWindow?.();
      }
    } catch (error) {
      console.warn("[quickEntryNative] navigateToChat failed", error);
    }
  });

  unsubscribeAccount = next.account.subscribe(() => {
    if (!wired) return;
    // Official id() listener: setLoggedIn(hit()) + PwA()
    void syncLoggedIn(wired, next.account);
    void configureSwiftApiCredentials(deps, wired);
  });

  attachCookieListener();

  wired = nr;
  deps = next;
  void syncLoggedIn(nr, next.account);
  // Official: after load, push current store + credentials + dictation.
  void pushRecentChatsToOverlay(nr);
  void configureSwiftApiCredentials(next, nr);
  configureSwiftDictationLanguage(next, nr);
  // Official owe residual: nr.on("optionDoubleTapped", rwe) when shortcut is double-tap-option.
  ensureOptionDoubleTapListener(nr, next);
}

/**
 * Official owe residual:
 *   if (!i2A() || gi("quickEntryShortcut") !== "double-tap-option" || P9i) removeListener
 *   else nr.on("optionDoubleTapped", rwe)
 * rwe → if hit() then overlay.toggle else show main.
 * Product: no P9i (menubar helper); shortcut from deps preference getter optional.
 */
let optionDoubleTapWired: ClaudeSwiftAddon | null = null;

function ensureOptionDoubleTapListener(
  nr: ClaudeSwiftAddon,
  next: QuickEntryNativeDeps,
): void {
  const pref =
    typeof next.getQuickEntryShortcut === "function"
      ? next.getQuickEntryShortcut()
      : "double-tap-option";
  try {
    nr.removeListener(
      "optionDoubleTapped",
      onOptionDoubleTapped as (...args: unknown[]) => void,
    );
  } catch {
    /* ignore */
  }
  optionDoubleTapWired = null;
  // Official: only wire for double-tap-option (SSA default). null/undefined → treat as default.
  if (pref !== "double-tap-option" && pref !== undefined && pref !== null) {
    return;
  }
  nr.on("optionDoubleTapped", onOptionDoubleTapped);
  optionDoubleTapWired = nr;
  console.info("[quickEntryNative] owe residual: optionDoubleTapped → H9i");
}

async function onOptionDoubleTapped(): Promise<void> {
  console.info("[quickEntryNative] optionDoubleTapped (official rwe)");
  if (!deps) return;
  if (!isQuickEntryLoggedIn(deps.account)) {
    deps.showMainWindow?.();
    return;
  }
  await toggleNativeQuickEntryOverlay();
}

/**
 * Official Y9i residual: load Swift when t2A(), wire nr events.
 * Returns the addon when ready, else null (honest).
 */
export async function ensureNativeQuickEntry(
  next: QuickEntryNativeDeps,
): Promise<ClaudeSwiftAddon | null> {
  deps = next;
  if (!isNativeQuickEntryFeatureSupported()) return null;
  const nr = await loadClaudeSwiftAddon();
  if (!nr) return null;
  wireEvents(nr, next);
  return nr;
}

/**
 * Official H9i residual body is only overlay.toggle().
 * Y9i already wires setLoggedIn(hit()) on account changes; product re-awaits
 * setLoggedIn / setRecentChats / credentials before toggle so first paint matches
 * residual when account store raced ahead of Swift MainActor.
 *
 * Share strip under the bar is residual Swift QuickEntryBar permission CTA:
 * setOverlayVisible → AXIsProcessTrustedWithOptions + ScreenCapture refresh →
 * paint "与 Claude 快速分享内容" when loggedIn ∧ !permissionBannerDismissed ∧
 * missing accessibility and/or screenshot. Do not invent HTML/CSS strip UI.
 *
 * Returns true only when toggle() was invoked on a real overlay.
 */
export async function toggleNativeQuickEntryOverlay(): Promise<boolean> {
  const nr = getClaudeSwiftAddonCached() ?? (await loadClaudeSwiftAddon());
  if (!nr?.quickAccess?.overlay || typeof nr.quickAccess.overlay.toggle !== "function") {
    console.warn("[quickEntryNative] Swift not loaded, cannot show Quick Entry overlay");
    return false;
  }
  try {
    const loggedIn = deps ? isQuickEntryLoggedIn(deps.account) : true;
    // Await setLoggedIn Promise so Coordinator._loggedIn is true before show.
    if (deps) {
      await syncLoggedIn(nr, deps.account);
    } else {
      try {
        const r = nr.quickAccess.overlay.setLoggedIn?.(loggedIn);
        if (r && typeof (r as Promise<unknown>).then === "function") await r;
      } catch (error) {
        console.warn("[quickEntryNative] setLoggedIn re-push failed", error);
      }
    }
    await pushRecentChatsToOverlay(nr);
    await configureSwiftApiCredentials(deps, nr);
    try {
      const { systemPreferences } = await import("electron");
      console.info("[quickEntryNative] H9i toggle", {
        loggedIn,
        recentChats: recentChatsStore.length,
        screen: systemPreferences.getMediaAccessStatus("screen"),
        accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      });
    } catch {
      /* ignore */
    }
    // Warm ScreenCapture residual before overlay paint (desktop.getOpenWindows).
    // Official DesktopObserver needs AX; when AX false wins=[] and CTA shows.
    try {
      const desktop = (nr as ClaudeSwiftAddon & {
        desktop?: { getOpenWindows?: () => unknown };
      }).desktop;
      if (desktop && typeof desktop.getOpenWindows === "function") {
        await Promise.race([
          Promise.resolve(desktop.getOpenWindows()),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
      }
    } catch (error) {
      console.warn("[quickEntryNative] getOpenWindows warm failed", error);
    }
    const toggled = nr.quickAccess.overlay.toggle();
    if (toggled && typeof (toggled as Promise<unknown>).then === "function") {
      await toggled;
    }
    return true;
  } catch (error) {
    console.warn("[quickEntryNative] overlay.toggle failed", error);
    return false;
  }
}

/**
 * Official yst native branch:
 *   if i2A() return OSe() ? (await H9i(), true) : false
 *
 * Return:
 *   - "handled" → Lst must not open main
 *   - "logged-out" → native path applicable but user not logged in → Lst shows main
 *   - "unavailable" → fall through to Electron yst residual
 */
export async function tryActivateNativeQuickEntry(
  next: QuickEntryNativeDeps,
): Promise<"handled" | "logged-out" | "unavailable"> {
  if (!isNativeQuickEntryFeatureSupported()) return "unavailable";

  const nr = await ensureNativeQuickEntry(next);
  if (!nr) return "unavailable";

  // Official i2A true path
  if (!isQuickEntryLoggedIn(next.account)) {
    return "logged-out";
  }

  const toggled = await toggleNativeQuickEntryOverlay();
  return toggled ? "handled" : "unavailable";
}

/** Test helper. */
export function resetQuickEntryNativeForTests(): void {
  wired = null;
  unsubscribeAccount?.();
  unsubscribeAccount = null;
  deps = null;
  recentChatsStore = [];
  activeChatIdStore = null;
  optionDoubleTapWired = null;
}
