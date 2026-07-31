import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAutofixOnPrCreateFromAccountSettings,
  isAutofixOnPrCreateFromUserData,
  isCoworkMemoryEnabledFromAccountSettings,
  isCoworkMemoryEnabledFromUserData,
  isEagerConnectorToolLoad,
  isEagerConnectorToolLoadFromUserData,
  normalizeToolSearchMode,
  readAccountSettingsFromUserData,
  toolSearchModeFromAccountSettings,
} from "./toolAccessMode";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("toolAccessMode residual", () => {
  it("normalizes auto/missing/unknown to on", () => {
    expect(normalizeToolSearchMode(undefined)).toBe("on");
    expect(normalizeToolSearchMode("auto")).toBe("on");
    expect(normalizeToolSearchMode("on")).toBe("on");
    expect(normalizeToolSearchMode("off")).toBe("off");
  });

  it("eager only when off", () => {
    expect(isEagerConnectorToolLoad("off")).toBe(true);
    expect(isEagerConnectorToolLoad("on")).toBe(false);
    expect(isEagerConnectorToolLoad(undefined)).toBe(false);
  });

  it("reads tool_search_mode from account settings bag", () => {
    expect(
      toolSearchModeFromAccountSettings({ tool_search_mode: "off" }),
    ).toBe("off");
    expect(toolSearchModeFromAccountSettings({})).toBe("on");
    expect(toolSearchModeFromAccountSettings(null)).toBe("on");
  });

  it("reads account-settings.json from userData", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-access-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "account-settings.json"),
      JSON.stringify({ tool_search_mode: "off", enabled_saffron: true }),
      "utf8",
    );
    expect(readAccountSettingsFromUserData(dir).tool_search_mode).toBe("off");
    expect(isEagerConnectorToolLoadFromUserData(dir)).toBe(true);
  });

  it("missing disk bag is non-eager", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-access-empty-"));
    dirs.push(dir);
    expect(readAccountSettingsFromUserData(dir)).toEqual({});
    expect(isEagerConnectorToolLoadFromUserData(dir)).toBe(false);
  });

  it("enabled_cowork_memory defaults ON; explicit false disables", () => {
    expect(isCoworkMemoryEnabledFromAccountSettings(null)).toBe(true);
    expect(isCoworkMemoryEnabledFromAccountSettings({})).toBe(true);
    expect(
      isCoworkMemoryEnabledFromAccountSettings({ enabled_cowork_memory: true }),
    ).toBe(true);
    expect(
      isCoworkMemoryEnabledFromAccountSettings({ enabled_cowork_memory: false }),
    ).toBe(false);
  });

  it("reads enabled_cowork_memory from userData account-settings.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-memory-"));
    dirs.push(dir);
    expect(isCoworkMemoryEnabledFromUserData(dir)).toBe(true);
    fs.writeFileSync(
      path.join(dir, "account-settings.json"),
      JSON.stringify({ enabled_cowork_memory: false }),
      "utf8",
    );
    expect(isCoworkMemoryEnabledFromUserData(dir)).toBe(false);
    fs.writeFileSync(
      path.join(dir, "account-settings.json"),
      JSON.stringify({ enabled_cowork_memory: true }),
      "utf8",
    );
    expect(isCoworkMemoryEnabledFromUserData(dir)).toBe(true);
  });

  it("ccr_autofix_on_pr_create defaults OFF; explicit true enables", () => {
    expect(isAutofixOnPrCreateFromAccountSettings(null)).toBe(false);
    expect(isAutofixOnPrCreateFromAccountSettings({})).toBe(false);
    expect(
      isAutofixOnPrCreateFromAccountSettings({ ccr_autofix_on_pr_create: false }),
    ).toBe(false);
    expect(
      isAutofixOnPrCreateFromAccountSettings({ ccr_autofix_on_pr_create: true }),
    ).toBe(true);
  });

  it("reads ccr_autofix_on_pr_create from userData account-settings.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-pr-"));
    dirs.push(dir);
    expect(isAutofixOnPrCreateFromUserData(dir)).toBe(false);
    fs.writeFileSync(
      path.join(dir, "account-settings.json"),
      JSON.stringify({ ccr_autofix_on_pr_create: true }),
      "utf8",
    );
    expect(isAutofixOnPrCreateFromUserData(dir)).toBe(true);
  });
});
