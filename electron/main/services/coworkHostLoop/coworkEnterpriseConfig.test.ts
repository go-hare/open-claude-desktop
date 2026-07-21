import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isCoworkEnterpriseRequireFullVmSandbox,
  loadCoworkEnterpriseConfig,
  parseCoworkEnterpriseBoolean,
  readXmlPlistBooleanKey,
  resetCoworkEnterpriseConfigForTests,
  resolveCoworkConfigLibraryMetaPath,
  resolveCoworkManagedPreferencesPlistPaths,
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
