import { describe, expect, it } from "vitest";
import {
  COWORK_HOST_LOOP_RESUME_REJECTED,
  readCoworkForceHostLoopEnv,
  readCoworkHostLoopFeatureEnv,
  resolveCoworkHostLoopMode,
  resolveCoworkHostLoopModeForNewSession,
  shouldRejectCoworkHostLoopResume,
} from "./coworkHostLoopMode";

describe("resolveCoworkHostLoopModeForNewSession", () => {
  it("disables host loop when org requires full VM sandbox", () => {
    expect(
      resolveCoworkHostLoopModeForNewSession({
        hostLoopFeatureEnabled: true,
        requireCoworkFullVmSandbox: true,
      }),
    ).toBe(false);
  });

  it("disables host loop when forceDisableHostLoop is set", () => {
    expect(
      resolveCoworkHostLoopModeForNewSession({
        forceDisableHostLoop: true,
        hostLoopFeatureEnabled: true,
      }),
    ).toBe(false);
  });

  it("enables host loop via CLAUDE_FORCE_HOST_LOOP under developer override", () => {
    expect(
      resolveCoworkHostLoopModeForNewSession({
        forceHostLoopEnv: true,
        hostLoopFeatureEnabled: false,
        isDeveloperApprovedDevUrlOverrideEnabled: true,
      }),
    ).toBe(true);
  });

  it("ignores CLAUDE_FORCE_HOST_LOOP without developer override", () => {
    expect(
      resolveCoworkHostLoopModeForNewSession({
        forceHostLoopEnv: true,
        hostLoopFeatureEnabled: false,
        isDeveloperApprovedDevUrlOverrideEnabled: false,
      }),
    ).toBe(false);
  });

  it("follows the host-loop feature flag when policy allows", () => {
    expect(resolveCoworkHostLoopModeForNewSession({ hostLoopFeatureEnabled: true })).toBe(true);
    expect(resolveCoworkHostLoopModeForNewSession({ hostLoopFeatureEnabled: false })).toBe(false);
    expect(resolveCoworkHostLoopModeForNewSession({})).toBe(false);
  });
});

describe("resolveCoworkHostLoopMode resume inherit", () => {
  it("inherits existing hostLoopMode on resume", () => {
    expect(
      resolveCoworkHostLoopMode({
        existingHostLoopMode: true,
        isNewSession: false,
        policy: { hostLoopFeatureEnabled: false },
      }),
    ).toBe(true);
    expect(
      resolveCoworkHostLoopMode({
        existingHostLoopMode: false,
        isNewSession: false,
        policy: { hostLoopFeatureEnabled: true },
      }),
    ).toBe(false);
  });

  it("uses new-session policy when isNewSession", () => {
    expect(
      resolveCoworkHostLoopMode({
        existingHostLoopMode: false,
        isNewSession: true,
        policy: { hostLoopFeatureEnabled: true },
      }),
    ).toBe(true);
  });
});

describe("shouldRejectCoworkHostLoopResume", () => {
  it("rejects host-loop resume when org now requires full VM sandbox", () => {
    expect(shouldRejectCoworkHostLoopResume(true, true)).toBe(true);
    expect(shouldRejectCoworkHostLoopResume(true, false)).toBe(false);
    expect(shouldRejectCoworkHostLoopResume(false, true)).toBe(false);
  });

  it("keeps the official rejection copy available for callers", () => {
    expect(COWORK_HOST_LOOP_RESUME_REJECTED).toMatch(/VM sandbox/);
  });
});

describe("env helpers", () => {
  it("reads force and feature env values", () => {
    expect(readCoworkForceHostLoopEnv({ CLAUDE_FORCE_HOST_LOOP: "1" })).toBe(true);
    expect(readCoworkForceHostLoopEnv({})).toBe(false);
    expect(readCoworkHostLoopFeatureEnv({ CLAUDE_HOST_LOOP_FEATURE: "0" })).toBe(false);
    expect(readCoworkHostLoopFeatureEnv({ CLAUDE_HOST_LOOP_FEATURE: "1" })).toBe(true);
    expect(readCoworkHostLoopFeatureEnv({})).toBeUndefined();
  });
});
