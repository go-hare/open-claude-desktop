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
 *    - Official Anthropic binary 1p → mN https://claude.ai
 *    - Official 3p → app://localhost
 *    - **Product shell** always hosts open-claude-web / app:// (independent product).
 *      Do NOT force navigate product mainView to claude.ai — that skips LoginDesktop.
 *
 * 2) Login surface (ion-dist LoginDesktop residual, NOT a separate BrowserWindow):
 *    - sVt: fixed inset-0 bg-bg-100 centered shell (+ 36px drag bar)
 *    - M5t: "How do you want to use Claude?" / "Sign in to Anthropic" cards
 *    - T5t portal only when getLoginDesktop3pStatus is truthy
 *    - Verify sign-in code is the only small BrowserWindow (520×340)
 *
 * CLAUDE_DESKTOP_MAIN_VIEW_URL / app:// remain product main load.
 * CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1 opts into official mN host (rare).
 */
export function resolveMainWindowLoadUrl(input: {
  deploymentMode: DesktopDeploymentMode;
  baseUrl?: string;
  productMainViewUrl?: string;
  forceAnthropicMainView?: boolean;
  sidebarMode?: SidebarMode;
  hasRendererConfig?: boolean;
}): string {
  const forceAnthropic =
    input.forceAnthropicMainView
    ?? process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW === "1";

  if (input.deploymentMode === "1p" && forceAnthropic) {
    return `${anthropicOriginUrl()}/`;
  }

  if (input.productMainViewUrl) {
    return normalizeProductMainViewUrl(input.productMainViewUrl);
  }

  return resolveInitialMainViewUrl(
    input.baseUrl ?? "app://localhost",
    normalizeSidebarMode(input.sidebarMode),
    input.hasRendererConfig ?? false,
  );
}
