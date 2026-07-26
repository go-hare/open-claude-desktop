import { describe, expect, it } from "vitest";
import {
  resolveIsDxtEnabled,
  resolveIsLocalDevMcpEnabled,
} from "./localDevMcpPolicy";

describe("resolveIsLocalDevMcpEnabled (InA residual)", () => {
  it("defaults enabled when enterprise + features keys are absent", () => {
    expect(resolveIsLocalDevMcpEnabled()).toBe(true);
    expect(resolveIsLocalDevMcpEnabled({})).toBe(true);
  });

  it("enterprise explicit false disables regardless of features", () => {
    expect(
      resolveIsLocalDevMcpEnabled({
        enterpriseIsLocalDevMcpEnabled: false,
        featureIsLocalDevMcpEnabled: true,
      }),
    ).toBe(false);
  });

  it("features explicit false disables when enterprise not false", () => {
    expect(
      resolveIsLocalDevMcpEnabled({
        featureIsLocalDevMcpEnabled: false,
      }),
    ).toBe(false);
    expect(
      resolveIsLocalDevMcpEnabled({
        enterpriseIsLocalDevMcpEnabled: true,
        featureIsLocalDevMcpEnabled: false,
      }),
    ).toBe(false);
  });

  it("features true / enterprise true stays enabled", () => {
    expect(
      resolveIsLocalDevMcpEnabled({
        enterpriseIsLocalDevMcpEnabled: true,
        featureIsLocalDevMcpEnabled: true,
      }),
    ).toBe(true);
  });

  it("does not treat missing feature as false (Boolean(undefined) anti-pattern)", () => {
    expect(
      resolveIsLocalDevMcpEnabled({
        featureIsLocalDevMcpEnabled: undefined,
      }),
    ).toBe(true);
  });
});

describe("resolveIsDxtEnabled residual", () => {
  it("defaults enabled when keys absent", () => {
    expect(resolveIsDxtEnabled()).toBe(true);
  });

  it("enterprise isDesktopExtensionEnabled false disables", () => {
    expect(
      resolveIsDxtEnabled({
        enterpriseIsDesktopExtensionEnabled: false,
        featureIsDxtEnabled: true,
      }),
    ).toBe(false);
  });

  it("features isDxtEnabled false disables", () => {
    expect(resolveIsDxtEnabled({ featureIsDxtEnabled: false })).toBe(false);
  });
});
