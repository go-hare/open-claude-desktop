import { afterEach, expect, it, vi } from "vitest";
import {
  clearCoworkDirectoryBridgeForTests,
  listInstalledCoworkDirectoryServers,
  lookupCoworkDirectoryServers,
  respondCoworkDirectoryServers,
  searchCoworkDirectoryServers,
  setCoworkDirectoryBridgeDispatcher,
} from "./coworkMcpDirectoryBridge";

afterEach(() => {
  clearCoworkDirectoryBridgeForTests();
});

it("resolves directory search when web responds with servers", async () => {
  setCoworkDirectoryBridgeDispatcher({
    emit: (event) => {
      expect(event.type).toBe("directory_servers_search");
      expect(event.sessionId).toBe("sid-1");
      const payload = JSON.parse(event.data) as {
        keywords: string[];
        requestId: string;
      };
      expect(payload.keywords).toEqual(["gmail"]);
      respondCoworkDirectoryServers(payload.requestId, [
        {
          uuid: "8c1b41b4-c060-4704-8c17-95c39fa3511c",
          name: "Gmail",
          oneLiner: "inbox",
        },
      ]);
    },
  });

  const servers = await searchCoworkDirectoryServers("sid-1", ["gmail"]);
  expect(servers).toEqual([
    {
      uuid: "8c1b41b4-c060-4704-8c17-95c39fa3511c",
      name: "Gmail",
      oneLiner: "inbox",
    },
  ]);
});

it("resolves lookup and list_installed reverse-RPC types", async () => {
  const types: string[] = [];
  setCoworkDirectoryBridgeDispatcher({
    emit: (event) => {
      types.push(event.type);
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkDirectoryServers(payload.requestId, [
        { uuid: "u1", name: "Custom" },
      ]);
    },
  });

  await expect(lookupCoworkDirectoryServers("sid", ["u1"])).resolves.toEqual([
    { uuid: "u1", name: "Custom" },
  ]);
  await expect(listInstalledCoworkDirectoryServers("sid", [])).resolves.toEqual([
    { uuid: "u1", name: "Custom" },
  ]);
  expect(types).toEqual([
    "directory_servers_lookup",
    "directory_servers_list_installed",
  ]);
});

it("returns empty when dispatcher missing or response unknown", async () => {
  setCoworkDirectoryBridgeDispatcher(null);
  await expect(searchCoworkDirectoryServers("sid", ["x"])).resolves.toEqual([]);

  setCoworkDirectoryBridgeDispatcher({
    emit: () => {
      /* never respond — wait for timeout would be slow; respond wrong id */
      respondCoworkDirectoryServers("nope", [{ uuid: "a", name: "A" }]);
    },
  });
  // Force immediate timeout path by responding only after short race is not needed —
  // unknown requestId is a no-op warn; pending will hang. Use a fake dispatcher that
  // immediately responds to the real requestId after emit.
  setCoworkDirectoryBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkDirectoryServers(payload.requestId, "not-array");
    },
  });
  await expect(searchCoworkDirectoryServers("sid", [])).resolves.toEqual([]);
});

it("ignores malformed server entries when normalizing", async () => {
  setCoworkDirectoryBridgeDispatcher({
    emit: (event) => {
      const payload = JSON.parse(event.data) as { requestId: string };
      respondCoworkDirectoryServers(payload.requestId, [
        null,
        { uuid: 1, name: "bad" },
        { uuid: "ok", name: "Ok", toolNames: ["a", 2, "b"], enabledInChat: true },
      ]);
    },
  });
  const servers = await searchCoworkDirectoryServers("sid", []);
  expect(servers).toEqual([
    {
      uuid: "ok",
      name: "Ok",
      toolNames: ["a", "b"],
      enabledInChat: true,
    },
  ]);
});

it("times out directory request after DIRECTORY_TIMEOUT_MS", async () => {
  vi.useFakeTimers();
  try {
    setCoworkDirectoryBridgeDispatcher({
      emit: () => {
        /* no response */
      },
    });
    const pending = searchCoworkDirectoryServers("sid", ["slow"]);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
