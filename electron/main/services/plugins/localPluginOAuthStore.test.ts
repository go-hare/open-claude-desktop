import { beforeEach, describe, expect, it, vi } from "vitest";

const encryptString = vi.fn((value: string) => Buffer.from(`enc:${value}`, "utf8"));
const decryptString = vi.fn((buf: Buffer) => {
  const s = buf.toString("utf8");
  if (s.startsWith("enc:")) return s.slice(4);
  throw new Error("bad cipher");
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => encryptString(value),
    decryptString: (buf: Buffer) => decryptString(buf),
  },
}));

// vi.mock is hoisted — keep bag on globalThis to avoid TDZ.
const g = globalThis as unknown as {
  __pluginOAuthTestStores?: Map<string, Map<string, unknown>>;
};
g.__pluginOAuthTestStores = new Map();

vi.mock("electron-store", () => {
  const bagsOf = () => {
    const gThis = globalThis as unknown as {
      __pluginOAuthTestStores?: Map<string, Map<string, unknown>>;
    };
    if (!gThis.__pluginOAuthTestStores) {
      gThis.__pluginOAuthTestStores = new Map();
    }
    return gThis.__pluginOAuthTestStores;
  };
  const bag = (name: string) => {
    const bags = bagsOf();
    let m = bags.get(name);
    if (!m) {
      m = new Map();
      bags.set(name, m);
    }
    return m;
  };
  return {
    default: class MockStore {
      name: string;
      constructor(opts: { name: string }) {
        this.name = opts.name;
        bag(this.name);
      }
      get(key: string) {
        return bag(this.name).get(key);
      }
      set(key: string, value: unknown) {
        bag(this.name).set(key, value);
      }
      clear() {
        bag(this.name).clear();
      }
    },
  };
});

import {
  applyPluginEnvMutations,
  clearPluginOAuthCredentials,
  getPluginEnvValue,
  isReservedPluginEnvVar,
  isValidPluginEnvVarName,
  pluginOAuthScopeKey,
  readPluginOAuthClient,
  readPluginOAuthCredentials,
  resetLocalPluginOAuthStoresForTests,
  setPluginShimPermissions,
  getPluginShimPermissionMap,
  writePluginOAuthClient,
  writePluginOAuthCredentials,
} from "./localPluginOAuthStore";
import {
  parsePluginClis,
  pluginIdsFrom,
  commandMatchHash,
  shimKeysForOps,
} from "./localPluginCliManifest";

describe("localPluginOAuthStore residual", () => {
  beforeEach(() => {
    g.__pluginOAuthTestStores = new Map();
    resetLocalPluginOAuthStoresForTests();
    encryptString.mockClear();
    decryptString.mockClear();
  });

  it("scope key matches a8 residual", () => {
    expect(pluginOAuthScopeKey("a", "o", "p", "cli")).toBe("a:o:p:cli");
  });

  it("reserves ANTHROPIC_/PATH style env vars (wL)", () => {
    expect(isReservedPluginEnvVar("ANTHROPIC_API_KEY")).toBe(true);
    expect(isReservedPluginEnvVar("PATH")).toBe(true);
    expect(isReservedPluginEnvVar("MY_PLUGIN_TOKEN")).toBe(false);
    expect(isValidPluginEnvVarName("MY_PLUGIN_TOKEN")).toBe(true);
    expect(isValidPluginEnvVarName("bad-name")).toBe(false);
  });

  it("writes and reads OAuth clientConfig (a9i/Iit)", () => {
    writePluginOAuthClient("acc", "org", "plug", "default", {
      clientId: " cid ",
      clientSecret: "sec",
    });
    expect(readPluginOAuthClient("acc", "org", "plug", "default")).toEqual({
      clientId: "cid",
      clientSecret: "sec",
    });
    // clear both → delete entry
    writePluginOAuthClient("acc", "org", "plug", "default", {
      clientId: "",
      clientSecret: "",
    });
    expect(readPluginOAuthClient("acc", "org", "plug", "default")).toBeNull();
  });

  it("writes credentials and clears via cit residual", () => {
    writePluginOAuthCredentials("acc", "org", "plug", "default", {
      access_token: "t",
      expiresAt: 123,
    });
    expect(readPluginOAuthCredentials("acc", "org", "plug", "default")).toMatchObject({
      access_token: "t",
      expiresAt: 123,
    });
    clearPluginOAuthCredentials("acc", "org", "plug", "default");
    expect(readPluginOAuthCredentials("acc", "org", "plug", "default")).toBeNull();
  });

  it("applies env set/delete mutations (s9i)", () => {
    applyPluginEnvMutations("acc", "org", "plug", "default", [
      {
        op: "set",
        envKey: "token",
        envVar: "MY_PLUGIN_TOKEN",
        value: "secret-value",
        secret: false,
      },
    ]);
    expect(
      getPluginEnvValue("acc", "org", "plug", "default", "token", "MY_PLUGIN_TOKEN"),
    ).toEqual({ value: "secret-value", savedAsSecret: false });
    applyPluginEnvMutations("acc", "org", "plug", "default", [
      { op: "delete", envKey: "token", envVar: "MY_PLUGIN_TOKEN" },
    ]);
    expect(
      getPluginEnvValue("acc", "org", "plug", "default", "token", "MY_PLUGIN_TOKEN"),
    ).toBeNull();
  });

  it("persists shim permissions (Bit/lit)", () => {
    setPluginShimPermissions(["mp/p:default:op:hash"], "allow");
    expect(getPluginShimPermissionMap()["mp/p:default:op:hash"]).toBe("allow");
    setPluginShimPermissions(["mp/p:default:op:hash"], null);
    expect(getPluginShimPermissionMap()["mp/p:default:op:hash"]).toBeUndefined();
  });
});

describe("localPluginCliManifest residual H_/Gq", () => {
  it("parses clis map and legacy top-level oauth", () => {
    const modern = parsePluginClis({
      name: "demo",
      clis: {
        main: {
          oauth: { clientId: "x", authorizationUrl: "https://auth.example" },
          env: { token: { envVar: "MY_PLUGIN_TOKEN" } },
          commands: [{ op: "read", match: ".*" }],
        },
      },
    });
    expect(modern.main?.oauth).toMatchObject({ clientId: "x" });
    expect(modern.main?.env?.token.envVar).toBe("MY_PLUGIN_TOKEN");
    expect(modern.main?.commands?.[0]?.op).toBe("read");

    const legacy = parsePluginClis({
      oauth: { provider: { clientId: "legacy" } },
      confirm: [{ op: "run", match: "foo" }],
    });
    expect(legacy.default?.oauth).toMatchObject({ clientId: "legacy" });
    expect(legacy.default?.commands?.[0]?.op).toBe("run");
  });

  it("builds shim keys for ops (CPe)", () => {
    const ids = pluginIdsFrom("demo@org-provisioned", "demo", "default");
    expect(ids.marketplaceName).toBe("org-provisioned");
    const keys = shimKeysForOps(
      ids,
      [{ op: "read", match: ".*" }],
      ["read"],
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("org-provisioned/demo:default:read:");
    expect(commandMatchHash({ op: "read", match: ".*" })).toHaveLength(32);
  });
});
