import { describe, expect, it } from "vitest";
import { isClaudeCurrentlyHealthyResidual } from "./claudeHealthcheck";

describe("claudeHealthcheck residual ocr", () => {
  it("destroyed window → false", async () => {
    await expect(
      isClaudeCurrentlyHealthyResidual({ destroyed: true }),
    ).resolves.toBe(false);
  });

  it("status healthy → true", async () => {
    await expect(
      isClaudeCurrentlyHealthyResidual({
        fetchStatus: async () => "healthy",
      }),
    ).resolves.toBe(true);
  });

  it("status unhealthy → false (no invent healthy)", async () => {
    await expect(
      isClaudeCurrentlyHealthyResidual({
        fetchStatus: async () => "unhealthy",
      }),
    ).resolves.toBe(false);
  });
});
