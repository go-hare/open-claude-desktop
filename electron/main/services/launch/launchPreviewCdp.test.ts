import { describe, expect, it } from "vitest";
import {
  LaunchPreviewCdp,
  type PreviewElementContext,
} from "./launchPreviewCdp";

/**
 * Pure residual shape checks — CDP attach needs real Electron debugger,
 * so we only assert public types + class surface here (no invent).
 */
describe("LaunchPreviewCdp residual surface", () => {
  it("exposes official method names used by Launch Preview APIs", () => {
    const cdp = new LaunchPreviewCdp();
    expect(typeof cdp.attach).toBe("function");
    expect(typeof cdp.detach).toBe("function");
    expect(typeof cdp.setViewport).toBe("function");
    expect(typeof cdp.clearViewport).toBe("function");
    expect(typeof cdp.setColorScheme).toBe("function");
    expect(typeof cdp.enableInspectMode).toBe("function");
    expect(typeof cdp.disableInspectMode).toBe("function");
    expect(typeof cdp.captureElementContext).toBe("function");
    expect(typeof cdp.takeScreenshot).toBe("function");
    expect(typeof cdp.takeScreenshotViaCDP).toBe("function");
    // Official zFi residual surface used by Claude Preview MCP (HOi / rue).
    expect(typeof cdp.takeScreenshotCompressed).toBe("function");
    expect(typeof cdp.takeScreenshotViaCDPCompressed).toBe("function");
    expect(typeof cdp.inspectElement).toBe("function");
    expect(typeof cdp.click).toBe("function");
    expect(typeof cdp.fill).toBe("function");
    expect(typeof cdp.evaluate).toBe("function");
    expect(typeof cdp.takeSnapshot).toBe("function");
    expect(typeof cdp.formatSnapshotAsText).toBe("function");
    expect(typeof cdp.getConsoleLogs).toBe("function");
    expect(typeof cdp.getNetworkEntries).toBe("function");
    expect(typeof cdp.getResponseBody).toBe("function");
    expect(cdp.isAttached()).toBe(false);
    expect(cdp.emulationScale).toBe(1);
  });

  it("ZFt elementSelected context shape keys are documented", () => {
    // Official ZFt residual required fields — keep as contract for captureElementContext.
    const sample: PreviewElementContext = {
      tagName: "button",
      classes: ["primary"],
      attributes: { type: "button" },
      computedStyles: { display: "flex" },
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      screenshot: "",
    };
    expect(sample.tagName).toBe("button");
    expect(Array.isArray(sample.classes)).toBe(true);
  });
});
