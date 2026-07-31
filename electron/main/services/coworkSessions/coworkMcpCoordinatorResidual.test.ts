import { describe, expect, it } from "vitest";
import {
  CoworkMcpRootsRegistry,
  createCoworkMcpCoordinatorInjects,
  createCoworkMcpServerResidual,
  createCoworkRemoteMcpServersResidual,
} from "./coworkMcpCoordinatorResidual";

describe("CoworkMcpRootsRegistry", () => {
  it("registers and unregisters roots getters", async () => {
    const registry = new CoworkMcpRootsRegistry();
    registry.register("s1", async () => ["/tmp/a", "/tmp/b"]);
    await expect(registry.getRoots("s1")).resolves.toEqual(["/tmp/a", "/tmp/b"]);
    registry.unregister("s1");
    await expect(registry.getRoots("s1")).resolves.toEqual([]);
  });
});

describe("createCoworkMcpServerResidual", () => {
  it("returns local config bag when present", () => {
    const result = createCoworkMcpServerResidual(
      {
        enabled: true,
        name: "filesystem",
        type: "local",
        uuid: "u1",
        tools: ["read"],
      },
      {
        filesystem: { command: "npx", args: ["-y", "mcp"] },
      },
    );
    expect(result?.key).toBe("filesystem");
    expect(result?.server).toEqual(
      expect.objectContaining({ command: "npx", name: "filesystem", uuid: "u1" }),
    );
  });

  it("returns null for local missing bag", () => {
    expect(
      createCoworkMcpServerResidual(
        {
          enabled: true,
          name: "missing",
          type: "local",
          uuid: "u-missing",
        },
        {},
      ),
    ).toBeNull();
  });

  it("returns remote descriptor when not local and no bag", () => {
    const result = createCoworkMcpServerResidual(
      {
        enabled: true,
        name: "github",
        type: "http",
        uuid: "uuid-g",
        tools: [{ name: "search" }],
      },
      {},
    );
    expect(result?.key).toBe("uuid-g");
    expect(result?.server).toEqual(
      expect.objectContaining({ type: "http", name: "github", uuid: "uuid-g" }),
    );
  });
});

describe("createCoworkRemoteMcpServersResidual", () => {
  it("maps remotes by jC key", () => {
    const bag = createCoworkRemoteMcpServersResidual({
      remoteMcpServers: [
        { name: "A", uuid: "u-a", tools: ["t1"], type: "http" },
        { name: "local-fs", uuid: "u-l", tools: [], type: "local" },
      ],
    });
    expect(Object.keys(bag).sort()).toEqual(["local-fs", "u-a"]);
  });
});

describe("createCoworkMcpCoordinatorInjects", () => {
  it("wires injects that call residual builders", async () => {
    const registry = new CoworkMcpRootsRegistry();
    const injects = createCoworkMcpCoordinatorInjects({
      rootsRegistry: registry,
      getLocalMcpConfigs: () => ({
        demo: { command: "echo" },
      }),
    });
    injects.registerRootsProvider("sess", () => ["/root"]);
    await expect(registry.getRoots("sess")).resolves.toEqual(["/root"]);
    injects.unregisterRootsProvider("sess");
    expect(registry.has("sess")).toBe(false);

    const created = await injects.createMcpServer("sess", {
      enabled: true,
      name: "demo",
      type: "local",
      uuid: "u-demo",
    });
    expect(created?.key).toBe("demo");

    const remote = await injects.createRemoteMcpServers("sess", {
      remoteMcpServers: [{ name: "R", uuid: "u-r", tools: [] }],
    });
    expect(remote["u-r"]).toBeTruthy();
  });
});
