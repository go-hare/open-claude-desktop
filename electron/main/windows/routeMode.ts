import type { DesktopDeploymentMode } from "../services/custom3p/deploymentMode";
import type { InitialRouteMode, SidebarMode } from "./types";

export function normalizeSidebarMode(sidebarMode?: SidebarMode): InitialRouteMode {
  if (sidebarMode === "code") return "epitaxy";
  if (sidebarMode === "task") return "task";
  if (sidebarMode === "epitaxy") return "epitaxy";
  return "chat";
}

/**
 * Official mN residual (app.asar):
 *   function mN() {
 *     const i = "https://claude.ai";
 *     return e.buildType === "dev"
 *       ? process.env.CLAUDE_AI_URL || Xo().claudeAiUrl || i
 *       : (!A && globalThis.isDeveloperApprovedDevUrlOverrideEnabled && process.env.CLAUDE_AI_URL)
 *         ? process.env.CLAUDE_AI_URL
 *         : i;
 *   }
 * Product: always honor CLAUDE_AI_URL when set; else https://claude.ai.
 */
export function anthropicOriginUrl(): string {
  const fromEnv = process.env.CLAUDE_AI_URL?.trim();
  if (fromEnv) {
    try {
      const url = new URL(fromEnv);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return `${url.protocol}//${url.host}`;
      }
    } catch {
      /* fall through */
    }
  }
  return "https://claude.ai";
}

export function resolveInitialMainViewUrl(baseUrl: string, mode: InitialRouteMode, hasRendererConfig = false): string {
  const url = new URL(baseUrl);

  // Mirrors original logic:
  // - with a discovered 3P renderer config, chat/task both enter /task/new; code enters /epitaxy
  // - without it, sidebarMode decides; chat keeps the base URL
  const targetMode = hasRendererConfig ? (mode === "epitaxy" ? "epitaxy" : "task") : mode;

  if (targetMode === "task") {
    url.pathname = "/task/new";
  } else if (targetMode === "epitaxy") {
    url.pathname = "/epitaxy";
  }

  return url.toString();
}

function normalizeProductMainViewUrl(value: string): string {
  const url = new URL(value);
  if (!["app:", "http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported main view URL protocol: ${url.protocol}`);
  }
  // Official mainView preload trusts localhost / app://localhost / claude.ai.
  if (
    (url.hostname === "127.0.0.1" || url.hostname === "::1")
    && (url.protocol === "http:" || url.protocol === "https:")
  ) {
    url.hostname = "localhost";
  }
  return url.toString();
}

/**
 * Official residual (two layers — do not collapse them):
 *
 * 1) Window URL (hai/Cai getMainWindowUrl):
 *    - Official Anthropic binary **after NQt("1p")** → mN https://claude.ai
 *    - Official 3p → app://localhost
 *    - Unconfigured / void chooser is still product app:// LoginDesktop (M5t).
 *      `resolution.mode === "1p"` alone is NOT enough (no bag also resolves 1p).
 *      Only **persisted** `deploymentMode === "1p"` means the user chose Anthropic.
 *
 * 2) Login surface (ion-dist LoginDesktop residual, NOT a separate BrowserWindow):
 *    - sVt + M5t dual cards while chooser mode is void / 3p bag present
 *    - Sign in to Anthropic → NQt("1p") → jsA + relaunch → mN claude.ai (real OAuth host)
 *    - Product must not loop product SPA /login after that write (prior bug: 1p card
 *      looked dead — relaunch reloaded app:// chooser with mode still painting M5t).
 *
 * CLAUDE_DESKTOP_MAIN_VIEW_URL remains product main for 3p / void / dev.
 * CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1 forces mN even without persisted 1p.
 * CLAUDE_FORCE_PRODUCT_MAIN_VIEW=1 keeps product SPA even when persisted 1p (tests).
 */
/**
 * Official loadAll residual (app.asar vst / Frr era):
 *   Q = new URL(or())  // or() = hai.getMainWindowUrl() = mN() https://claude.ai
 *   sidebar task → Q.pathname = "/task/new"; Q.searchParams.set("coldLaunch","1")
 *   sidebar code → Q.pathname = "/epitaxy"
 * Bare `https://claude.ai/` is the public marketing landing ("Question what's next" /
 * Download desktop app). Desktop 1p must load the product path, not the marketing root.
 */
export function resolveAnthropicMainWindowUrl(sidebarMode?: SidebarMode): string {
  const url = new URL(`${anthropicOriginUrl()}/`);
  const mode = normalizeSidebarMode(sidebarMode);
  if (mode === "epitaxy") {
    url.pathname = "/epitaxy";
  } else {
    // chat / task residual — same as official loadAll when hasRendererConfig/task
    url.pathname = "/task/new";
    // Official cold launch marker on first mainView load of Anthropic host.
    url.searchParams.set("coldLaunch", "1");
  }
  return url.toString();
}

/**
 * Stamp residual entry path onto a product origin (dev Vite / CLAUDE_DESKTOP_MAIN_VIEW_URL).
 * Official ion Pos: void/clear → LoginRoute; 3p shell → /task/new (or /epitaxy).
 * Prior product short-circuit returned bare origin → cold start after Sign out painted
 * main shell then soft-nav /login + resize(600) → "主窗口一闪再小窗".
 */
function productMainViewUrlWithResidualPath(
  productMainViewUrl: string,
  persistedDeploymentMode: DesktopDeploymentMode | undefined,
  sidebarMode?: SidebarMode,
  hasRendererConfig = false,
): string {
  const origin = normalizeProductMainViewUrl(productMainViewUrl);
  if (persistedDeploymentMode === "3p" || persistedDeploymentMode === "dotClaude") {
    return resolveInitialMainViewUrl(
      origin,
      normalizeSidebarMode(sidebarMode),
      hasRendererConfig,
    );
  }
  // Void chooser (Sign out clear / first launch) and non-1p residual → LoginRoute.
  // Persisted "1p" with forceProduct also lands here (debug product shell as 1p).
  if (persistedDeploymentMode !== "1p") {
    const url = new URL(origin);
    url.pathname = "/login";
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  return resolveInitialMainViewUrl(
    origin,
    normalizeSidebarMode(sidebarMode),
    hasRendererConfig,
  );
}

export function resolveMainWindowLoadUrl(input: {
  deploymentMode: DesktopDeploymentMode;
  /**
   * Official jsA residual — only `"1p"` after chooser means load mN.
   * Undefined/clear keeps product LoginDesktop even when N1e mode is 1p.
   */
  persistedDeploymentMode?: DesktopDeploymentMode | undefined;
  baseUrl?: string;
  productMainViewUrl?: string;
  forceAnthropicMainView?: boolean;
  sidebarMode?: SidebarMode;
  hasRendererConfig?: boolean;
}): string {
  const forceAnthropic =
    input.forceAnthropicMainView
    ?? process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW === "1";
  const forceProduct = process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW === "1";
  const choseAnthropic1p = input.persistedDeploymentMode === "1p" || forceAnthropic;

  // Official hai + loadAll: mN origin + /task/new (not marketing `/`).
  if (choseAnthropic1p && !forceProduct) {
    return resolveAnthropicMainWindowUrl(input.sidebarMode);
  }

  if (input.productMainViewUrl) {
    return productMainViewUrlWithResidualPath(
      input.productMainViewUrl,
      input.persistedDeploymentMode,
      input.sidebarMode,
      input.hasRendererConfig ?? false,
    );
  }

  // Packaged app:// void chooser: stamp /login (same residual as product origin above).
  if (
    input.persistedDeploymentMode !== "1p"
    && input.persistedDeploymentMode !== "3p"
    && input.persistedDeploymentMode !== "dotClaude"
  ) {
    const url = new URL(input.baseUrl ?? "app://localhost");
    url.pathname = "/login";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  return resolveInitialMainViewUrl(
    input.baseUrl ?? "app://localhost",
    normalizeSidebarMode(input.sidebarMode),
    input.hasRendererConfig ?? false,
  );
}
