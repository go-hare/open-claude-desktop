import { describe, expect, it, vi } from "vitest";
import { CodeSessionAttentionService } from "./codeSessionAttention";

describe("CodeSessionAttentionService (dockBounceEnabled residual)", () => {
  it("no-ops when dockBounceEnabled is false", () => {
    const flashFrame = vi.fn();
    const service = new CodeSessionAttentionService({
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          flashFrame,
        }) as never,
      isDockBounceEnabled: () => false,
    });
    // Force unfocused path by stubbing method.
    vi.spyOn(service, "isAppFocusedAndVisible").mockReturnValue(false);
    service.requestUserAttention();
    expect(flashFrame).not.toHaveBeenCalled();
  });

  it("flashes frame on non-darwin when enabled and unfocused", () => {
    if (process.platform === "darwin") return;
    const flashFrame = vi.fn();
    const service = new CodeSessionAttentionService({
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          flashFrame,
        }) as never,
      isDockBounceEnabled: () => true,
    });
    vi.spyOn(service, "isAppFocusedAndVisible").mockReturnValue(false);
    service.requestUserAttention();
    expect(flashFrame).toHaveBeenCalledWith(true);
  });

  it("no-ops when app is focused", () => {
    const flashFrame = vi.fn();
    const service = new CodeSessionAttentionService({
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          flashFrame,
        }) as never,
      isDockBounceEnabled: () => true,
    });
    vi.spyOn(service, "isAppFocusedAndVisible").mockReturnValue(true);
    service.requestUserAttention();
    expect(flashFrame).not.toHaveBeenCalled();
  });
});
