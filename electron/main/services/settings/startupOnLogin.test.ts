import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS,
  isStartupOnLoginEnabled,
  resolveStartupLoginItemPath,
  setStartupOnLoginEnabled,
  shouldShowMainWindowOnCreate,
  STARTUP_LOGIN_ITEM_NAME,
} from "./startupOnLogin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startupOnLogin residual (EKA / xSe / SEr)", () => {
  it("xSe darwin / non-win returns bare execPath", () => {
    expect(
      resolveStartupLoginItemPath({
        platform: "darwin",
        execPath: "/Apps/Claude-Deepseek.app/Contents/MacOS/Claude-Deepseek",
      }),
    ).toBe("/Apps/Claude-Deepseek.app/Contents/MacOS/Claude-Deepseek");
  });

  it("xSe win32 non-MSIX uses parent basename + --startup", () => {
    const execPath = "C:\\\\Users\\\\x\\\\AppData\\\\Local\\\\Claude\\\\app-1\\\\Claude.exe";
    const expectedTarget = path.resolve(
      path.dirname(execPath),
      "..",
      path.basename(execPath),
    );
    expect(
      resolveStartupLoginItemPath({
        platform: "win32",
        execPath,
        isMsix: () => false,
      }),
    ).toBe(`"${expectedTarget}" --startup`);
  });

  it("xSe win32 MSIX returns bare execPath", () => {
    expect(
      resolveStartupLoginItemPath({
        platform: "win32",
        execPath: "C:\\\\Program Files\\\\WindowsApps\\\\Claude\\\\Claude.exe",
        isMsix: () => true,
      }),
    ).toBe("C:\\\\Program Files\\\\WindowsApps\\\\Claude\\\\Claude.exe");
  });

  it("isStartupOnLoginEnabled respects CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS", () => {
    expect(
      isStartupOnLoginEnabled({
        env: { [CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS]: "1" },
        getLoginItemSettings: () => ({ openAtLogin: true }),
      }),
    ).toBe(false);
  });

  it("isStartupOnLoginEnabled true on openAtLogin or executableWillLaunchAtLogin", () => {
    expect(
      isStartupOnLoginEnabled({
        env: {},
        platform: "darwin",
        execPath: "/bin/Claude",
        getLoginItemSettings: () => ({ openAtLogin: true }),
      }),
    ).toBe(true);
    expect(
      isStartupOnLoginEnabled({
        env: {},
        platform: "darwin",
        execPath: "/bin/Claude",
        getLoginItemSettings: () => ({
          openAtLogin: false,
          executableWillLaunchAtLogin: true,
        }),
      }),
    ).toBe(true);
    expect(
      isStartupOnLoginEnabled({
        env: {},
        platform: "darwin",
        execPath: "/bin/Claude",
        getLoginItemSettings: () => ({
          openAtLogin: false,
          executableWillLaunchAtLogin: false,
        }),
      }),
    ).toBe(false);
  });

  it("setStartupOnLoginEnabled writes openAtLogin+enabled+path+name", () => {
    const writes: Array<Record<string, unknown>> = [];
    let stored = false;
    const pathArg = resolveStartupLoginItemPath({
      platform: "darwin",
      execPath: "/bin/Claude-Deepseek",
    });
    const ok = setStartupOnLoginEnabled(true, {
      platform: "darwin",
      execPath: "/bin/Claude-Deepseek",
      env: {},
      setLoginItemSettings: (s) => {
        writes.push(s as unknown as Record<string, unknown>);
        stored = s.openAtLogin;
      },
      getLoginItemSettings: () => ({
        openAtLogin: stored,
        executableWillLaunchAtLogin: stored,
      }),
    });
    expect(ok).toBe(true);
    expect(writes).toEqual([
      {
        openAtLogin: true,
        enabled: true,
        path: pathArg,
        name: STARTUP_LOGIN_ITEM_NAME,
      },
    ]);
  });

  it("SEr darwin: hide when !avoid && wasOpenedAtLogin (official polarity)", () => {
    // Normal login-item launch → hide main window (quiet boot).
    expect(
      shouldShowMainWindowOnCreate({
        platform: "darwin",
        env: {},
        getLoginItemSettings: () => ({ wasOpenedAtLogin: true }),
      }),
    ).toBe(false);
    // Interactive launch → show.
    expect(
      shouldShowMainWindowOnCreate({
        platform: "darwin",
        env: {},
        getLoginItemSettings: () => ({ wasOpenedAtLogin: false }),
      }),
    ).toBe(true);
    // avoid env set → always show (even if wasOpenedAtLogin).
    expect(
      shouldShowMainWindowOnCreate({
        platform: "darwin",
        env: { [CLAUDE_AVOID_READING_LOGING_ITEM_SETTINGS]: "1" },
        getLoginItemSettings: () => ({ wasOpenedAtLogin: true }),
      }),
    ).toBe(true);
  });

  it("SEr win32: hide when argv has --startup", () => {
    expect(
      shouldShowMainWindowOnCreate({
        platform: "win32",
        argv: ["electron", "."],
      }),
    ).toBe(true);
    expect(
      shouldShowMainWindowOnCreate({
        platform: "win32",
        argv: ["Claude.exe", "--startup"],
      }),
    ).toBe(false);
  });
});
