import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => "/tmp/no-such-electron-exe",
    getAppPath: () => process.cwd(),
  },
}));

describe("devSwiftPrivacyPlist official residual", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exports official mic/speech usage strings and Claude CFBundleName", async () => {
    const mod = await import("./devSwiftPrivacyPlist");
    expect(mod.OFFICIAL_MICROPHONE_USAGE_DESCRIPTION).toContain("microphone");
    expect(mod.OFFICIAL_SPEECH_RECOGNITION_USAGE_DESCRIPTION).toContain(
      "speech recognition",
    );
    expect(mod.OFFICIAL_CF_BUNDLE_NAME).toBe("Claude");
    expect(mod.resolveProductDisplayName()).toBe("Claudex");
  });

  it("respects CLAUDE_PRODUCT_NAME for display residual", async () => {
    const prev = process.env.CLAUDE_PRODUCT_NAME;
    process.env.CLAUDE_PRODUCT_NAME = "Claude-Test";
    vi.resetModules();
    const mod = await import("./devSwiftPrivacyPlist");
    expect(mod.resolveProductDisplayName()).toBe("Claude-Test");
    if (prev === undefined) delete process.env.CLAUDE_PRODUCT_NAME;
    else process.env.CLAUDE_PRODUCT_NAME = prev;
  });
});
