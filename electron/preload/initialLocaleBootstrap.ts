/**
 * Residual bootstrap for secondary/main window preloads:
 *   const { messages, locale } = DesktopIntl.getInitialLocale() // sendSync
 *   expose initialMessages / initialLocale
 *
 * data-official-source: app.asar aboutWindow.js / buddy.js tail
 * Main handler returns { messages, locale } (settingsHandlers getInitialLocalePayload).
 */
import { electronIntl } from "./intlBridge";

export type InitialLocaleBootstrap = {
  messages: Record<string, unknown>;
  locale: string;
};

export function readInitialLocaleBootstrap(): InitialLocaleBootstrap {
  const result = electronIntl.getInitialLocale() as
    | { messages?: unknown; locale?: unknown }
    | null
    | undefined;

  const locale =
    result && typeof result.locale === "string" && result.locale.length > 0
      ? result.locale
      : "en-US";
  const messages =
    result && result.messages && typeof result.messages === "object"
      ? (result.messages as Record<string, unknown>)
      : {};

  return { messages, locale };
}
