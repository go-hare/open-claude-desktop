/**
 * Official desktop dialog i18n residual (app.asar Fxe / VWt dialogs + en-US.json ids):
 *
 *   Fxe BEFORE_USE denied:
 *     message id AtL30+PDZZ  "Claude needs microphone permission"
 *     detail  id VGKaynmhvx  "You'll need to grant Claude access..."
 *     buttons: ["Open System Settings", "Cancel"]
 *
 *   Fxe HOTKEY denied (usage expected):
 *     message id i6wCMcpNrS  "You've used {key} to speak to Claude..."
 *     detail  id sLqBzYBjWk + b2BK4WgyMA
 *     key label: Caps Lock (tGP7K8z3w7) or accelerator string
 *     buttons: ["Open System Settings", "Open Claude Settings", "Cancel"]
 *
 *   Config load errors (Pne / WWt):
 *     D4DyT6MmPy / rwFEudHXey
 *     KYFNJPLx9T / rfqC+v5aF0
 *
 * Messages sourced from official Resources/{locale}.json (12 locales).
 * Product residual: locale preference → bag lookup → en-US fallback.
 * Does not invent missing locales; falls back to en-US.
 */
import messagesByLocale from "./desktopDialogI18n.messages.json";

export type DesktopDialogMessageId =
  | "AtL30+PDZZ"
  | "VGKaynmhvx"
  | "i6wCMcpNrS"
  | "sLqBzYBjWk"
  | "b2BK4WgyMA"
  | "tGP7K8z3w7"
  | "KYFNJPLx9T"
  | "rfqC+v5aF0"
  | "D4DyT6MmPy"
  | "rwFEudHXey";

export type DesktopDialogLocaleBag = Record<string, string>;

const MESSAGES = messagesByLocale as Record<string, DesktopDialogLocaleBag>;

/** Official button labels (hardcoded English in Fxe; residual + zh via tree). */
export const DESKTOP_DIALOG_BUTTONS = {
  openSystemSettings: {
    "en-US": "Open System Settings",
    "zh-CN": "打开系统设置",
    "ja-JP": "システム設定を開く",
    "de-DE": "Systemeinstellungen öffnen",
    "fr-FR": "Ouvrir les réglages système",
    "es-ES": "Abrir Configuración del sistema",
    "es-419": "Abrir Configuración del Sistema",
    "ko-KR": "시스템 설정 열기",
    "pt-BR": "Abrir Configurações do Sistema",
    "it-IT": "Apri Impostazioni di sistema",
    "id-ID": "Buka Pengaturan Sistem",
    "hi-IN": "सिस्टम सेटिंग्स खोलें",
  },
  openClaudeSettings: {
    "en-US": "Open Claude Settings",
    "zh-CN": "打开 Claude 设置",
    "ja-JP": "Claude の設定を開く",
    "de-DE": "Claude-Einstellungen öffnen",
    "fr-FR": "Ouvrir les paramètres Claude",
    "es-ES": "Abrir ajustes de Claude",
    "es-419": "Abrir ajustes de Claude",
    "ko-KR": "Claude 설정 열기",
    "pt-BR": "Abrir configurações do Claude",
    "it-IT": "Apri impostazioni di Claude",
    "id-ID": "Buka Pengaturan Claude",
    "hi-IN": "Claude सेटिंग्स खोलें",
  },
  cancel: {
    "en-US": "Cancel",
    "zh-CN": "取消",
    "ja-JP": "キャンセル",
    "de-DE": "Abbrechen",
    "fr-FR": "Annuler",
    "es-ES": "Cancelar",
    "es-419": "Cancelar",
    "ko-KR": "취소",
    "pt-BR": "Cancelar",
    "it-IT": "Annulla",
    "id-ID": "Batal",
    "hi-IN": "रद्द करें",
  },
} as const;

export type DesktopDialogButtonId = keyof typeof DESKTOP_DIALOG_BUTTONS;

const FALLBACK_LOCALE = "en-US";

/** Normalize product locale (e.g. zh_CN, zh) → bag key. */
export function resolveDialogLocale(locale: string | null | undefined): string {
  if (!locale || typeof locale !== "string") return FALLBACK_LOCALE;
  const trimmed = locale.trim().replace(/_/g, "-");
  if (!trimmed) return FALLBACK_LOCALE;
  if (MESSAGES[trimmed]) return trimmed;
  // language-only match (zh → zh-CN if present)
  const lang = trimmed.split("-")[0]!.toLowerCase();
  const candidates = Object.keys(MESSAGES).filter(
    (k) => k.toLowerCase() === lang || k.toLowerCase().startsWith(`${lang}-`),
  );
  if (candidates.length === 1) return candidates[0]!;
  // prefer exact region-less map: zh → zh-CN when only one zh*
  const preferred = candidates.find((k) => k.toLowerCase().startsWith(`${lang}-`));
  if (preferred) return preferred;
  return FALLBACK_LOCALE;
}

export function formatDialogMessage(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

export function getDialogMessage(
  id: DesktopDialogMessageId,
  locale?: string | null,
  values: Record<string, string | number> = {},
): string {
  const resolved = resolveDialogLocale(locale);
  const bag = MESSAGES[resolved] ?? MESSAGES[FALLBACK_LOCALE] ?? {};
  const fallback = MESSAGES[FALLBACK_LOCALE] ?? {};
  const template = bag[id] ?? fallback[id] ?? id;
  return formatDialogMessage(template, values);
}

export function getDialogButtonLabel(
  id: DesktopDialogButtonId,
  locale?: string | null,
): string {
  const resolved = resolveDialogLocale(locale);
  const bag = DESKTOP_DIALOG_BUTTONS[id] as Record<string, string>;
  return bag[resolved] ?? bag[FALLBACK_LOCALE] ?? id;
}

export type DictationShortcutValue =
  | "off"
  | "capslock"
  | "double-tap-capslock"
  | { accelerator: string }
  | unknown;

/** Official key label residual for HOTKEY dialog. */
export function formatDictationHotkeyLabel(
  shortcut: DictationShortcutValue,
  locale?: string | null,
): string {
  if (shortcut === "capslock" || shortcut === "double-tap-capslock") {
    return getDialogMessage("tGP7K8z3w7", locale);
  }
  if (
    shortcut
    && typeof shortcut === "object"
    && !Array.isArray(shortcut)
    && typeof (shortcut as { accelerator?: unknown }).accelerator === "string"
  ) {
    return (shortcut as { accelerator: string }).accelerator;
  }
  return String(shortcut ?? "");
}

/** Official Fxe BEFORE_USE denied copy. */
export function getMicrophoneBeforeUseDeniedCopy(locale?: string | null): {
  message: string;
  detail: string;
  buttons: [string, string];
} {
  return {
    message: getDialogMessage("AtL30+PDZZ", locale),
    detail: getDialogMessage("VGKaynmhvx", locale),
    buttons: [
      getDialogButtonLabel("openSystemSettings", locale),
      getDialogButtonLabel("cancel", locale),
    ],
  };
}

/** Official Fxe HOTKEY denied copy (usage expected). */
export function getMicrophoneHotkeyDeniedCopy(
  shortcut: DictationShortcutValue,
  locale?: string | null,
): {
  message: string;
  detail: string;
  buttons: [string, string, string];
} {
  const key = formatDictationHotkeyLabel(shortcut, locale);
  const detail1 = getDialogMessage("sLqBzYBjWk", locale);
  const detail2 = getDialogMessage("b2BK4WgyMA", locale);
  return {
    message: getDialogMessage("i6wCMcpNrS", locale, { key }),
    detail: `${detail1}\n\n${detail2}`,
    buttons: [
      getDialogButtonLabel("openSystemSettings", locale),
      getDialogButtonLabel("openClaudeSettings", locale),
      getDialogButtonLabel("cancel", locale),
    ],
  };
}

/** Official Pne config parse error dialog. */
export function getConfigLoadErrorCopy(
  error: string,
  locale?: string | null,
): { message: string; detail: string } {
  const truncated = error.length > 300 ? `${error.slice(0, 300)}…` : error;
  return {
    message: getDialogMessage("D4DyT6MmPy", locale),
    detail: getDialogMessage("rwFEudHXey", locale, { error: truncated }),
  };
}

/** Official WWt invalid MCP servers dialog. */
export function getInvalidMcpServersCopy(
  names: string[],
  locale?: string | null,
): { message: string; detail: string } {
  const shown = names.slice(0, 10).map((n) => (n.length > 40 ? `${n.slice(0, 40)}…` : n));
  let joined = names.length > 10
    ? `${shown.join(", ")} (and ${names.length - 10} more)`
    : shown.join(", ");
  if (joined.length > 300) joined = `${joined.slice(0, 300)}…`;
  return {
    message: getDialogMessage("KYFNJPLx9T", locale),
    detail: getDialogMessage("rfqC+v5aF0", locale, { names: joined }),
  };
}

export function listDialogLocales(): string[] {
  return Object.keys(MESSAGES).sort();
}

export function hasDialogLocale(locale: string): boolean {
  return Object.prototype.hasOwnProperty.call(MESSAGES, locale);
}
