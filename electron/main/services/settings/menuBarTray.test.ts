import { describe, expect, it, vi } from "vitest";
import {
  activateFromMenuBarTray,
  configureMenuBarTray,
  resetMenuBarTrayForTests,
  resolveTrayIconFileName,
  resolveTrayIconPath,
  shouldQuitOnMainWindowClose,
} from "./menuBarTray";

describe("menuBarTray residual helpers", () => {
  it("resolves mac template icon name", () => {
    expect(resolveTrayIconFileName({ platform: "darwin" })).toBe(
      "TrayIconTemplate.png",
    );
  });

  it("resolves win32 light/dark icon names", () => {
    expect(resolveTrayIconFileName({ platform: "win32", dark: false })).toBe(
      "Tray-Win32.ico",
    );
    expect(resolveTrayIconFileName({ platform: "win32", dark: true })).toBe(
      "Tray-Win32-Dark.ico",
    );
  });

  it("joins icon under resources root", () => {
    expect(
      resolveTrayIconPath("/app/Resources", { platform: "darwin" }),
    ).toMatch(/TrayIconTemplate\.png$/);
  });

  it("win32 quits on close when tray disabled", () => {
    expect(
      shouldQuitOnMainWindowClose({
        platform: "win32",
        menuBarEnabled: false,
      }),
    ).toBe(true);
    expect(
      shouldQuitOnMainWindowClose({
        platform: "win32",
        menuBarEnabled: true,
      }),
    ).toBe(false);
  });

  it("darwin never quits solely because tray is disabled", () => {
    expect(
      shouldQuitOnMainWindowClose({
        platform: "darwin",
        menuBarEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldQuitOnMainWindowClose({
        platform: "darwin",
        menuBarEnabled: true,
      }),
    ).toBe(false);
  });

  it("activateFromMenuBarTray skips main when quick entry returns true", async () => {
    resetMenuBarTrayForTests();
    const show = vi.fn();
    const focus = vi.fn();
    const openQuickEntry = vi.fn(async () => true);
    configureMenuBarTray({
      getEnabled: () => true,
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          isVisible: () => false,
          isMinimized: () => false,
          show,
          focus,
          restore: vi.fn(),
          moveTop: vi.fn(),
        }) as never,
      openQuickEntry,
    });
    await activateFromMenuBarTray();
    expect(openQuickEntry).toHaveBeenCalledOnce();
    expect(show).not.toHaveBeenCalled();
  });

  it("activateFromMenuBarTray shows main when quick entry returns false", async () => {
    resetMenuBarTrayForTests();
    const show = vi.fn();
    const focus = vi.fn();
    const moveTop = vi.fn();
    configureMenuBarTray({
      getEnabled: () => true,
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          isVisible: () => false,
          isMinimized: () => false,
          show,
          focus,
          restore: vi.fn(),
          moveTop,
        }) as never,
      openQuickEntry: async () => false,
    });
    await activateFromMenuBarTray();
    expect(show).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
});
