import { describe, expect, it } from "vitest";
import {
  formatDictationHotkeyLabel,
  getConfigLoadErrorCopy,
  getDialogMessage,
  getInvalidMcpServersCopy,
  getMicrophoneBeforeUseDeniedCopy,
  getMicrophoneHotkeyDeniedCopy,
  hasDialogLocale,
  listDialogLocales,
  resolveDialogLocale,
} from "./desktopDialogI18n";

describe("desktopDialogI18n Fxe / Pne residual", () => {
  it("ships official 12 locales", () => {
    const locales = listDialogLocales();
    expect(locales).toContain("en-US");
    expect(locales).toContain("zh-CN");
    expect(locales).toContain("ja-JP");
    expect(locales.length).toBeGreaterThanOrEqual(12);
  });

  it("resolveDialogLocale maps language and underscores", () => {
    expect(resolveDialogLocale("zh-CN")).toBe("zh-CN");
    expect(resolveDialogLocale("zh_CN")).toBe("zh-CN");
    expect(resolveDialogLocale("zh")).toBe("zh-CN");
    expect(resolveDialogLocale("nope")).toBe("en-US");
    expect(resolveDialogLocale(null)).toBe("en-US");
  });

  it("BEFORE_USE denied copy uses AtL30 / VGKay (en + zh)", () => {
    const en = getMicrophoneBeforeUseDeniedCopy("en-US");
    expect(en.message).toBe("Claude needs microphone permission");
    expect(en.detail).toContain("System Settings");
    expect(en.buttons[0]).toMatch(/System Settings|系统设置/);
    expect(en.buttons).toHaveLength(2);

    const zh = getMicrophoneBeforeUseDeniedCopy("zh-CN");
    expect(zh.message).toContain("麦克风");
    expect(zh.detail).toContain("系统设置");
    expect(zh.buttons[1]).toBe("取消");
  });

  it("HOTKEY denied copy interpolates Caps Lock / accelerator", () => {
    const caps = getMicrophoneHotkeyDeniedCopy("capslock", "en-US");
    expect(caps.message).toContain("Caps Lock");
    expect(caps.detail).toContain("dictation");
    expect(caps.buttons).toHaveLength(3);

    const accel = getMicrophoneHotkeyDeniedCopy(
      { accelerator: "CommandOrControl+Shift+D" },
      "en-US",
    );
    expect(accel.message).toContain("CommandOrControl+Shift+D");
    expect(formatDictationHotkeyLabel("double-tap-capslock", "zh-CN")).toBe(
      "大写锁定",
    );
  });

  it("config load / invalid mcp dialog trees", () => {
    const err = getConfigLoadErrorCopy("boom", "en-US");
    expect(err.message).toBe("Could not load app settings");
    expect(err.detail).toContain("boom");

    const mcp = getInvalidMcpServersCopy(["bad", "worse"], "zh-CN");
    expect(mcp.message).toContain("MCP");
    expect(mcp.detail).toContain("bad");
  });

  it("getDialogMessage falls back to en-US for unknown locale", () => {
    expect(getDialogMessage("AtL30+PDZZ", "xx-YY")).toBe(
      getDialogMessage("AtL30+PDZZ", "en-US"),
    );
    expect(hasDialogLocale("en-US")).toBe(true);
    expect(hasDialogLocale("xx-YY")).toBe(false);
  });
});
