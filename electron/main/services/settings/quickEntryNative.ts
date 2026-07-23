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

function resolveBaseUrl(next: QuickEntryNativeDeps | null): string {
  try {
    const url = next?.getMainViewWebContents?.()?.getURL?.();
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      return new URL(url).origin;
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
 * Official PwA residual:
 *   org = await dr() (lastActiveOrg cookie, UUID)
 *   base = or() (main window URL)
 *   cookieHeader = session cookies path="/" serialized
 *   nr.api.setCredentials(base, cookieHeader, org)
 *
 * Does not invent credentials when org cookie / api surface missing.
 */
export async function configureSwiftApiCredentials(
  next: QuickEntryNativeDeps | null = deps,
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): Promise<boolean> {
  if (!nr?.api || typeof nr.api.setCredentials !== "function") return false;
  try {
    const baseUrl = resolveBaseUrl(next);
    const cookies = await session.defaultSession.cookies.get({ url: baseUrl });
    const orgCookie = cookies.find((c) => c.name === "lastActiveOrg");
    const orgUuid = decodeOrgUuid(orgCookie?.value);
    if (!orgUuid) return false;
    // Official: path === "/" only
    const header = cookies
      .filter((c) => c.path === "/" || c.path === undefined || c.path === "")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    nr.api.setCredentials(baseUrl, header, orgUuid);
    return true;
  } catch (error) {
    console.warn("[quickEntryNative] setCredentials failed", error);
    return false;
  }
}

/**
 * Official dit residual: nr.quickAccess.dictation.setLanguage(mappedLocale).
 * Only runs when dictation surface exists — never invents dictation feature support.
 */
export function configureSwiftDictationLanguage(
  next: QuickEntryNativeDeps | null = deps,
  nr: ClaudeSwiftAddon | null = getClaudeSwiftAddonCached(),
): void {
  if (!nr?.quickAccess?.dictation || typeof nr.quickAccess.dictation.setLanguage !== "function") {
    return;
  }
  try {
    const locale = next?.getLocale?.() ?? null;
    if (!locale || typeof locale !== "string") return;
    // Official J9i maps full tags → short codes; pass base language honestly.
    const mapped = locale.toLowerCase().split("-")[0] || "en";
    nr.quickAccess.dictation.setLanguage(mapped);
  } catch (error) {
    console.warn("[quickEntryNative] dictation.setLanguage failed", error);
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
        const mapped = await mapNativeSubmit(record);
        const hasContent =
          (mapped.text && mapped.text.trim().length > 0) || mapped.images.length > 0;
        if (!hasContent) return;
        deps?.onSubmit(mapped);
        deps?.showMainWindow?.();
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
