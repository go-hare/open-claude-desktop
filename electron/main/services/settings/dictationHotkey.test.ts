import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDictationShortcutPreference,
  bootDictationHotkeys,
  getDictationSlotAcceleratorForTests,
  handleCapsLockChanged,
  registerGlobalShortcutSlot,
  resetDictationHotkeyForTests,
  resolveDictationMode,
  setGlobalShortcutSlotHandler,
  shouldListenForCapsLockDictation,
  GlobalShortcutSlot,
} from "./dictationHotkey";

const registerMock = vi.fn(() => true);
const unregisterMock = vi.fn();

vi.mock("electron", () => ({
  globalShortcut: {
    register: (...args: unknown[]) => registerMock(...args),
    unregister: (...args: unknown[]) => unregisterMock(...args),
  },
  systemPreferences: {
    getMediaAccessStatus: () => "granted",
    askForMediaAccess: async () => true,
  },
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
  },
  app: {
    getLocale: () => "en-US",
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

vi.mock("./claudeSwiftAddon", () => {
  const dictation = {
    setLanguage: vi.fn(),
    show: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
  };
  const nr = {
    quickAccess: { dictation, overlay: { toggle: vi.fn() } },
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return {
    getClaudeSwiftAddonCached: () => nr,
    loadClaudeSwiftAddon: async () => nr,
  };
});

afterEach(() => {
  resetDictationHotkeyForTests();
  registerMock.mockClear();
  unregisterMock.mockClear();
  registerMock.mockImplementation(() => true);
});

describe("dictationHotkey official Nme/PR/uit residual", () => {
  it("resolveDictationMode maps capslock → caps-lock else custom", () => {
    expect(resolveDictationMode("capslock")).toBe("caps-lock");
    expect(resolveDictationMode("double-tap-capslock")).toBe("custom");
    expect(resolveDictationMode({ accelerator: "Shift+K" })).toBe("custom");
    expect(resolveDictationMode("off")).toBe("custom");
  });

  it("shouldListenForCapsLockDictation follows x9i residual", () => {
    expect(shouldListenForCapsLockDictation("off", true)).toBe(false);
    expect(shouldListenForCapsLockDictation("capslock", true)).toBe(true);
    expect(shouldListenForCapsLockDictation({ accelerator: "Shift+K" }, true)).toBe(true);
    expect(shouldListenForCapsLockDictation("capslock", false)).toBe(false);
  });

  it("PR registers custom accelerator for DICTATION slot", () => {
    setGlobalShortcutSlotHandler(GlobalShortcutSlot.DICTATION, () => {});
    const result = registerGlobalShortcutSlot(
      GlobalShortcutSlot.DICTATION,
      "Shift+K",
    );
    expect(result).toBeNull();
    expect(registerMock).toHaveBeenCalledWith("Shift+K", expect.any(Function));
    expect(getDictationSlotAcceleratorForTests()).toBe("Shift+K");
  });

  it("PR rejects invalid accelerator", () => {
    setGlobalShortcutSlotHandler(GlobalShortcutSlot.DICTATION, () => {});
    const result = registerGlobalShortcutSlot(
      GlobalShortcutSlot.DICTATION,
      "NotARealKey+ZZ",
    );
    expect(result).toBe("invalid-accelerator");
    expect(getDictationSlotAcceleratorForTests()).toBeNull();
  });

  it("applyDictationShortcutPreference unregisters for off/capslock modes", async () => {
    setGlobalShortcutSlotHandler(GlobalShortcutSlot.DICTATION, () => {});
    registerGlobalShortcutSlot(GlobalShortcutSlot.DICTATION, "Shift+K");
    expect(getDictationSlotAcceleratorForTests()).toBe("Shift+K");

    await applyDictationShortcutPreference("off");
    expect(unregisterMock).toHaveBeenCalledWith("Shift+K");
    expect(getDictationSlotAcceleratorForTests()).toBeNull();

    registerGlobalShortcutSlot(GlobalShortcutSlot.DICTATION, "Shift+K");
    await applyDictationShortcutPreference("capslock");
    expect(getDictationSlotAcceleratorForTests()).toBeNull();
  });

  it("applyDictationShortcutPreference registers custom and resets on failure", async () => {
    const setDictationShortcut = vi.fn(() => true);
    await bootDictationHotkeys({
      getDictationShortcut: () => ({ accelerator: "Shift+K" }),
      setDictationShortcut,
      isDictationFeatureSupported: () => true,
    });
    expect(getDictationSlotAcceleratorForTests()).toBe("Shift+K");
    expect(setDictationShortcut).not.toHaveBeenCalled();

    registerMock.mockImplementation(() => false);
    const result = await applyDictationShortcutPreference({
      accelerator: "CommandOrControl+Shift+D",
    });
    expect(result).toBe("reset");
    expect(setDictationShortcut).toHaveBeenCalledWith("off");
  });

  it("double-tap-capslock nwe shows only within 600ms window", async () => {
    const { invokeDictationFromHotkey } = await import("./dictationHotkey");
    // boot so deps exist
    await bootDictationHotkeys({
      getDictationShortcut: () => "double-tap-capslock",
      setDictationShortcut: () => true,
      isDictationFeatureSupported: () => true,
    });

    // First tap alone should not show (HwA was null).
    // We assert via claudeSwift mock dictation.show call count.
    const { getClaudeSwiftAddonCached } = await import("./claudeSwiftAddon");
    const show = getClaudeSwiftAddonCached()?.quickAccess?.dictation?.show as
      | ReturnType<typeof vi.fn>
      | undefined;

    await handleCapsLockChanged(true);
    expect(show?.mock.calls.length ?? 0).toBe(0);

    await handleCapsLockChanged(true);
    expect(show?.mock.calls.length ?? 0).toBe(1);
    expect(show?.mock.calls[0]?.[0]).toBe("custom");

    // silence unused
    void invokeDictationFromHotkey;
  });
});
