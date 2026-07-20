import { afterEach, expect, it } from "vitest";
import {
  clearCoworkPluginSearchBridgeForTests,
  listInstalledCoworkPlugins,
  respondCoworkPluginSearch,
  searchCoworkPlugins,
  setCoworkPluginSearchBridgeDispatcher,
} from "./coworkPluginSearchBridge";

afterEach(() => {
  clearCoworkPluginSearchBridgeForTests();
});

it("resolves plugins_search when web responds", async () => {
  setCoworkPluginSearchBridgeDispatcher({
    emit: (event) => {
      expect(event.type).toBe("plugins_search");
      const payload = JSON.parse(event.data) as {
        requestId: string;
        listInstalledOnly?: boolean;
      };
      expect(payload.listInstalledOnly).toBe(true);
      respondCoworkPluginSearch(
        payload.requestId,
        JSON.stringify({
          results: [{ id: "a@org", name: "Alpha", description: "A" }],
        }),
      );
    },
  });
  const raw = await listInstalledCoworkPlugins("sid", ["alpha"]);
  const parsed = JSON.parse(raw) as { results: Array<{ name: string }> };
  expect(parsed.results[0]?.name).toBe("Alpha");
});

it("search_plugins passes userIntent and includeInstalled", async () => {
  setCoworkPluginSearchBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as {
        requestId: string;
        userIntent?: string;
        includeInstalled?: boolean;
      };
      expect(payload.userIntent).toBe("sales");
      expect(payload.includeInstalled).toBe(true);
      respondCoworkPluginSearch(payload.requestId, { results: [] });
    },
  });
  const raw = await searchCoworkPlugins("sid", "sales", ["crm"], "msg-1", true);
  expect(JSON.parse(raw)).toEqual({ results: [] });
});

it("returns empty results when dispatcher missing", async () => {
  const raw = await listInstalledCoworkPlugins("sid", undefined);
  expect(raw).toBe(JSON.stringify({ results: [] }));
});
