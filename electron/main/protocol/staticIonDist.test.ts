import { describe, expect, it } from "vitest";
import { RESIDUAL_APP_SPA_PATHS } from "./staticIonDist";

describe("RESIDUAL_APP_SPA_PATHS", () => {
  it("serves full official setup + device-code residual (not product approximate)", () => {
    // setup-desktop-3p: residual c71860c77 full enterprise UI (1:1 official).
    expect(RESIDUAL_APP_SPA_PATHS.has("/setup-desktop-3p")).toBe(true);
    expect(RESIDUAL_APP_SPA_PATHS.has("/device-code-verify")).toBe(true);
    expect(RESIDUAL_APP_SPA_PATHS.has("/task/new")).toBe(false);
  });
});
