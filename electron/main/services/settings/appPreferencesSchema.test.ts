import { describe, expect, it } from "vitest";
import { validateAppPreference } from "./appPreferencesSchema";

describe("validateAppPreference HSA residual", () => {
  it("accepts official booleans and sidebarMode enum", () => {
    expect(validateAppPreference("keepAwakeEnabled", true)).toEqual({
      ok: true,
      key: "keepAwakeEnabled",
      value: true,
    });
    expect(validateAppPreference("sidebarMode", "chat").ok).toBe(true);
    expect(validateAppPreference("sidebarMode", "epitaxy").ok).toBe(true);
  });

  it("rejects invalid official types / enums", () => {
    expect(validateAppPreference("keepAwakeEnabled", "yes").ok).toBe(false);
    expect(validateAppPreference("sidebarMode", "banana").ok).toBe(false);
    expect(validateAppPreference("vmMemoryGB", -1).ok).toBe(false);
    expect(validateAppPreference("vmMemoryGB", 1.5).ok).toBe(false);
    expect(validateAppPreference("coworkDisabledTools", "x").ok).toBe(false);
  });

  it("accepts product residual keys without inventing require true", () => {
    expect(validateAppPreference("locale", "zh-CN").ok).toBe(true);
    expect(validateAppPreference("deploymentMode", "gateway").ok).toBe(true);
    expect(validateAppPreference("requireCoworkFullVmSandbox", true).ok).toBe(
      true,
    );
    expect(validateAppPreference("requireCoworkFullVmSandbox", false).ok).toBe(
      true,
    );
    // string "true" must not pass — resolve path uses === true only
    expect(
      validateAppPreference("requireCoworkFullVmSandbox", "true").ok,
    ).toBe(false);
  });

  it("rejects unknown keys (official silent drop → product false)", () => {
    expect(validateAppPreference("notARealPref", 1).ok).toBe(false);
    expect(validateAppPreference("", true).ok).toBe(false);
    expect(validateAppPreference(12, true).ok).toBe(false);
  });

  it("accepts epitaxyPrefs object and null onboarding step", () => {
    expect(
      validateAppPreference("epitaxyPrefs", {
        "starred-cowork-spaces": [],
      }).ok,
    ).toBe(true);
    expect(validateAppPreference("coworkOnboardingResumeStep", null).ok).toBe(
      true,
    );
    expect(
      validateAppPreference("coworkOnboardingResumeStep", {
        step: "setup",
        accountKey: "a",
      }).ok,
    ).toBe(true);
  });
});
