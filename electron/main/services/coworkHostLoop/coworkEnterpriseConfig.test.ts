import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COWORK_ENTERPRISE_QB_KEYS,
  COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
  isCoworkEnterpriseRequireFullVmSandbox,
  loadCoworkEnterpriseConfig,
  parseCoworkEnterpriseBoolean,
  parseRegQueryValue,
  readManagedEnterpriseBag,
  readWindowsRequireCoworkFullVmSandbox,
  readXmlPlistBooleanKey,
  resetCoworkEnterpriseConfigForTests,
  resolveCoworkConfigLibraryMetaPath,
  resolveCoworkManagedPreferencesPlistPaths,
  resolveCoworkWindowsPoliciesKeyPath,
  setCoworkEnterpriseRemoteTier,
} from "./coworkEnterpriseConfig";
import { resolveCoworkRequireFullVmSandbox } from "./coworkHostLoopMode";
import { readCoworkHostLoopPolicy } from "./createCoworkHostLoopModeResolver";
import { resolveCoworkHostLoopModeForNewSession } from "./coworkHostLoopMode";

afterEach(() => {
  resetCoworkEnterpriseConfigForTests();
});

describe("coworkEnterpriseConfig pure helpers", () => {
  it("parses MDM booleans without inventing true", () => {
    expect(parseCoworkEnterpriseBoolean(true)).toBe(true);
    expect(parseCoworkEnterpriseBoolean("1")).toBe(true);
    expect(parseCoworkEnterpriseBoolean(false)).toBe(false);
    expect(parseCoworkEnterpriseBoolean(undefined)).toBeUndefined();
    expect(parseCoworkEnterpriseBoolean("maybe")).toBeUndefined();
  });

  it("reads XML plist boolean keys", () => {
    const xml = `<?xml version="1.0"?>
      <plist><dict>
        <key>requireCoworkFullVmSandbox</key>
        <true/>
      </dict></plist>`;
    expect(readXmlPlistBooleanKey(xml, "requireCoworkFullVmSandbox")).toBe(true);
    expect(readXmlPlistBooleanKey(xml, "missing")).toBeUndefined();
  });

  it("builds official managed plist paths", () => {
    const paths = resolveCoworkManagedPreferencesPlistPaths({ username: "alice" });
    expect(paths[0]).toBe(
      "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist",
    );
    expect(paths[1]).toContain("/alice/com.anthropic.claudefordesktop.plist");
  });

  it("builds win32 Policies key path residual", () => {
    expect(resolveCoworkWindowsPoliciesKeyPath("Claude")).toBe(
      "SOFTWARE\\Policies\\Claude",
    );
    expect(resolveCoworkWindowsPoliciesKeyPath("  ")).toBe(
      "SOFTWARE\\Policies\\Claude",
    );
  });

  it("parses reg query DWORD/SZ without inventing true", () => {
    expect(
      parseRegQueryValue(
        "    requireCoworkFullVmSandbox    REG_DWORD    0x1",
      ),
    ).toBe(1);
    expect(
      parseRegQueryValue(
        "    requireCoworkFullVmSandbox    REG_DWORD    0x0",
      ),
    ).toBe(0);
    expect(
      parseRegQueryValue("    foo    REG_SZ    true"),
    ).toBe("true");
    expect(parseRegQueryValue("ERROR: The system was unable")).toBeNull();
  });

  it("exports full official QB key list including require key", () => {
    expect(COWORK_ENTERPRISE_QB_KEYS).toContain(
      COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
    );
    expect(COWORK_ENTERPRISE_QB_KEYS.length).toBeGreaterThanOrEqual(50);
  });

  it("win32 Policies inject residual: first explicit boolean across hives", () => {
    const calls: string[] = [];
    const flag = readWindowsRequireCoworkFullVmSandbox({
      platform: "win32",
      getAppName: () => "Claude",
      readWindowsPolicyValue: ({ hive, valueName }) => {
        calls.push(`${hive}:${valueName}`);
        if (hive === "HKCU") return null;
        if (hive === "HKLM") return 1;
        return null;
      },
    });
    expect(flag).toBe(true);
    expect(calls).toEqual([
      `HKCU:${COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY}`,
      `HKLM:${COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY}`,
    ]);
  });

  it("win32 missing registry does not invent require true", () => {
    expect(
      readWindowsRequireCoworkFullVmSandbox({
        platform: "win32",
        readWindowsPolicyValue: () => null,
      }),
    ).toBeUndefined();
    expect(
      isCoworkEnterpriseRequireFullVmSandbox({
        platform: "win32",
        getManagedConfig: undefined,
        getLocalConfig: () => undefined,
        readWindowsPolicyValue: () => null,
      }),
    ).toBe(false);
  });
});

describe("loadCoworkEnterpriseConfig residual", () => {
  it("managed true forces require; source managed", () => {
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => ({ requireCoworkFullVmSandbox: true }),
    });
    expect(snap.source.type).toBe("managed");
    expect(snap.config.requireCoworkFullVmSandbox).toBe(true);
    expect(isCoworkEnterpriseRequireFullVmSandbox({
      getManagedConfig: () => ({ requireCoworkFullVmSandbox: true }),
    })).toBe(true);
  });

  it("local configLibrary residual when managed absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-ent-"));
    try {
      const appliedId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      fs.mkdirSync(path.join(root, "configLibrary"), { recursive: true });
      fs.writeFileSync(
        resolveCoworkConfigLibraryMetaPath(root),
        JSON.stringify({ appliedId }),
      );
      fs.writeFileSync(
        path.join(root, "configLibrary", `${appliedId}.json`),
        JSON.stringify({ requireCoworkFullVmSandbox: true }),
      );
      const snap = loadCoworkEnterpriseConfig({ getUserDataPath: () => root });
      expect(snap.source.type).toBe("local");
      expect(snap.config.requireCoworkFullVmSandbox).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("none when no managed/local and never invents true", () => {
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => undefined,
      getLocalConfig: () => undefined,
      platform: "linux",
    });
    expect(snap.source.type).toBe("none");
    expect(snap.config.requireCoworkFullVmSandbox).toBeUndefined();
    expect(
      isCoworkEnterpriseRequireFullVmSandbox({
        getManagedConfig: () => undefined,
        getLocalConfig: () => undefined,
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("remote tier overlays local base", () => {
    setCoworkEnterpriseRemoteTier({ requireCoworkFullVmSandbox: true });
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => undefined,
      getLocalConfig: () => ({ requireCoworkFullVmSandbox: false }),
    });
    expect(snap.source.remote).toBe(true);
    expect(snap.config.requireCoworkFullVmSandbox).toBe(true);
  });

  it("win32 registry managed residual forces dual-exec", () => {
    const snap = loadCoworkEnterpriseConfig({
      platform: "win32",
      getLocalConfig: () => undefined,
      getAppName: () => "Claude",
      readWindowsPolicyValue: ({ hive, valueName }) =>
        hive === "HKCU" && valueName === COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY
          ? 1
          : null,
    });
    expect(snap.source.type).toBe("managed");
    expect(snap.config.requireCoworkFullVmSandbox).toBe(true);
    const policy = readCoworkHostLoopPolicy({
      env: {},
      getHostLoopFeatureEnabled: () => true,
      getRequireCoworkFullVmSandbox: () =>
        resolveCoworkRequireFullVmSandbox({
          enterpriseValue: snap.config.requireCoworkFullVmSandbox === true,
        }),
    });
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(false);
  });

  it("full QB managed bag on raw; config only materializes require boolean", () => {
    const snap = loadCoworkEnterpriseConfig({
      getManagedConfig: () => ({
        requireCoworkFullVmSandbox: true,
        disableAutoUpdates: true,
        otlpEndpoint: "https://otel.example",
      }),
    });
    expect(snap.source.type).toBe("managed");
    expect(snap.config).toEqual({ requireCoworkFullVmSandbox: true });
    expect(snap.raw.requireCoworkFullVmSandbox).toBe(true);
    expect(snap.raw.disableAutoUpdates).toBe(true);
    expect(snap.raw.otlpEndpoint).toBe("https://otel.example");
    // Other QB keys not present are not invented on raw.
    expect(snap.raw.bootstrapEnabled).toBeUndefined();
  });

  it("readManagedEnterpriseBag walks only present keys (win32 inject)", () => {
    const bag = readManagedEnterpriseBag(
      {
        platform: "win32",
        readWindowsPolicyValue: ({ valueName }) =>
          valueName === "disableAutoUpdates"
            ? 1
            : valueName === COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY
              ? 0
              : null,
      },
      [
        COWORK_ENTERPRISE_REQUIRE_FULL_VM_KEY,
        "disableAutoUpdates",
        "bootstrapEnabled",
      ],
    );
    expect(bag).toEqual({
      requireCoworkFullVmSandbox: 0,
      disableAutoUpdates: 1,
    });
    expect(bag.bootstrapEnabled).toBeUndefined();
  });
});

describe("resolveCoworkRequireFullVmSandbox enterpriseValue", () => {
  it("enterprise true wins; absence does not invent", () => {
    expect(
      resolveCoworkRequireFullVmSandbox({ enterpriseValue: true, env: {} }),
    ).toBe(true);
    expect(resolveCoworkRequireFullVmSandbox({ env: {} })).toBe(false);
  });

  it("wires into host-loop policy dual-exec", () => {
    const policy = readCoworkHostLoopPolicy({
      env: {},
      getHostLoopFeatureEnabled: () => true,
      getRequireCoworkFullVmSandbox: () =>
        resolveCoworkRequireFullVmSandbox({ enterpriseValue: true }),
    });
    expect(resolveCoworkHostLoopModeForNewSession(policy)).toBe(false);
  });
});
