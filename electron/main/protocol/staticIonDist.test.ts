import { describe, expect, it } from "vitest";
import { RESIDUAL_APP_SPA_PATHS } from "./staticIonDist";

describe("RESIDUAL_APP_SPA_PATHS (Custom3p setup residual)", () => {
  it("includes official setup-desktop-3p and device-code-verify", () => {
    expect(RESIDUAL_APP_SPA_PATHS.has("/setup-desktop-3p")).toBe(true);
    expect(RESIDUAL_APP_SPA_PATHS.has("/device-code-verify")).toBe(true);
    expect(RESIDUAL_APP_SPA_PATHS.has("/task/new")).toBe(false);
  });
});
