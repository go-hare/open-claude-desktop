import { describe, expect, it } from "vitest";
import { isConnectorFaviconUrlForTests } from "./enterpriseNonessentialGate";

describe("enterpriseNonessentialGate (Ob residual)", () => {
  it("matches official connector-favicons hosts/paths", () => {
    expect(
      isConnectorFaviconUrlForTests(
        "https://www.google.com/s2/favicons?domain=example.com&sz=32",
      ),
    ).toBe(true);
    expect(
      isConnectorFaviconUrlForTests(
        "https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&url=http://example.com",
      ),
    ).toBe(true);
    expect(
      isConnectorFaviconUrlForTests("https://cdn.jsdelivr.net/npm/chart.js"),
    ).toBe(false);
    expect(isConnectorFaviconUrlForTests("https://claude.ai/favicon.ico")).toBe(
      false,
    );
  });
});
