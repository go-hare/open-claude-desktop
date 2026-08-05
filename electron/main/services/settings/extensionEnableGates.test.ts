import { describe, expect, it } from "vitest";
import {
  isDesktopExtensionDirectoryEnabledResidual,
  isDesktopExtensionSignatureRequiredResidual,
  isDirectoryEnabledResidual,
  isExtensionsEnabledResidual,
  refreshAllowlistCheckResidual,
} from "./extensionEnableGates";

describe("extensionEnableGates residual HN/YPA/L6e/b6e", () => {
  it("HN: default enabled when enterprise/features absent", () => {
    expect(isExtensionsEnabledResidual({ enterprise: {}, features: {} })).toBe(
      true,
    );
  });

  it("HN: enterprise isDesktopExtensionEnabled false disables", () => {
    expect(
      isExtensionsEnabledResidual({
        enterprise: { isDesktopExtensionEnabled: false },
        features: {},
      }),
    ).toBe(false);
  });

  it("HN: features.isDxtEnabled false disables", () => {
    expect(
      isExtensionsEnabledResidual({
        enterprise: {},
        features: { isDxtEnabled: false },
      }),
    ).toBe(false);
  });

  it("YPA: false when HN false", () => {
    expect(
      isDirectoryEnabledResidual({
        enterprise: { isDesktopExtensionEnabled: false },
        features: {},
      }),
    ).toBe(false);
  });

  it("YPA: false when enterprise directory false", () => {
    expect(
      isDirectoryEnabledResidual({
        enterprise: { isDesktopExtensionDirectoryEnabled: false },
        features: {},
      }),
    ).toBe(false);
  });

  it("YPA: false when features.isDxtDirectoryEnabled false", () => {
    expect(
      isDirectoryEnabledResidual({
        enterprise: {},
        features: { isDxtDirectoryEnabled: false },
      }),
    ).toBe(false);
  });

  it("YPA: true when HN and directory not explicitly false", () => {
    expect(
      isDirectoryEnabledResidual({ enterprise: {}, features: {} }),
    ).toBe(true);
  });

  it("L6e: only true when enterprise signature === true", () => {
    expect(isDesktopExtensionSignatureRequiredResidual({})).toBe(false);
    expect(
      isDesktopExtensionSignatureRequiredResidual({
        enterprise: { isDesktopExtensionSignatureRequired: false },
      }),
    ).toBe(false);
    expect(
      isDesktopExtensionSignatureRequiredResidual({
        enterprise: { isDesktopExtensionSignatureRequired: true },
      }),
    ).toBe(true);
  });

  it("b6e: only true when enterprise directory === true", () => {
    expect(isDesktopExtensionDirectoryEnabledResidual({})).toBe(false);
    expect(
      isDesktopExtensionDirectoryEnabledResidual({
        enterprise: { isDesktopExtensionDirectoryEnabled: true },
      }),
    ).toBe(true);
  });

  it("rKA: no-op without org policy backend (not invent true work)", async () => {
    const result = await refreshAllowlistCheckResidual({});
    expect(result.ran).toBe(false);
    expect(result.reason).toBe("no_org_policy_backend");
  });
});
