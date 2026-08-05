import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Wave A residual inventory lock.
 *
 * Preload lists every LocalAgentModeSessions invoke the web adapter may call.
 * Handlers must cover that surface (lesson from cancelQueuedMessage). Classification:
 * - real: core session lifecycle / workspace / MCP apply
 * - residual-honest: skills, bridge deny, interactiveAuth fail, TCC, direct MCP empty
 * - store: interactiveAuth + sessionsBridgeStatus getState (storeStateHandlers)
 * - product-delta: Anthropic remote bridge / OAuth — honest false/null, never soft-true
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(
  here,
  "../../preload/bridges/webBridge.ts",
);
const residualPath = path.resolve(here, "coworkLocalAgentResidualHandlers.ts");
const coworkHandlersPath = path.resolve(here, "coworkSessionsHandlers.ts");
const workspaceHandlersPath = path.resolve(
  here,
  "coworkSessionWorkspaceHandlers.ts",
);
const storeStatePath = path.resolve(here, "storeStateHandlers.ts");

function parseQuotedList(source: string, constName: string): string[] {
  const re = new RegExp(
    `const ${constName} = \\[\\s*([\\s\\S]*?)\\s*\\];`,
  );
  const match = source.match(re);
  if (!match) throw new Error(`missing ${constName}`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

function parseSecuredHandlerKeys(source: string): string[] {
  return [...source.matchAll(/^\s{4}([A-Za-z0-9_$]+):\s*secured/gm)].map(
    (m) => m[1]!,
  );
}

function parseReturnObjectKeys(source: string, fnName: string): string[] {
  const re = new RegExp(
    `function ${fnName}[\\s\\S]*?return \\{([\\s\\S]*?)\\n  \\};`,
  );
  const match = source.match(re);
  if (!match) throw new Error(`missing ${fnName} return bag`);
  return [...match[1]!.matchAll(/^\s{4}([A-Za-z0-9_$]+):/gm)].map((m) => m[1]!);
}

function parseRegisterOverrideKeys(source: string): string[] {
  const match = source.match(
    /registerInterfaceHandlers\(\s*"claude\.web",\s*"LocalAgentModeSessions",\s*\{([\s\S]*?)\},\s*"claude\.web\.LocalAgentModeSessions"/,
  );
  if (!match) throw new Error("missing LocalAgentModeSessions register bag");
  return [...match[1]!.matchAll(/^\s{6}([A-Za-z0-9_$]+):/gm)].map((m) => m[1]!);
}

function hasLocalAgentStore(source: string, storeName: string): boolean {
  return (
    source.includes(`iface: "LocalAgentModeSessions"`) &&
    source.includes(`storeName: "${storeName}"`)
  );
}

/** Product-delta methods: 3p cannot host Anthropic remote bridge / OAuth success. */
const PRODUCT_DELTA_HONEST = new Set([
  "getBridgeConsent",
  "kickBridgePoll",
  "resetBridge",
  "resetBridgeSession",
  "abandonBridgeEnvironment",
  "deleteBridgeSession",
  "deleteBridgeAgentMemory",
  "respondBridgePermissionPreflight",
  "getSessionsBridgeEnabled",
  "setSessionsBridgeEnabled",
  "sessionsBridgeStatus_$store$_getState",
  "triggerInteractiveAuth",
  "revokeInteractiveAuth",
  "interactiveAuth_$store$_getState",
  "authorizeDirectMcpServer",
  "getDirectMcpServerStatuses",
  "disconnectDirectMcpServer",
]);

describe("LocalAgentModeSessions residual inventory (Wave A)", () => {
  const preload = readFileSync(preloadPath, "utf8");
  const residual = readFileSync(residualPath, "utf8");
  const cowork = readFileSync(coworkHandlersPath, "utf8");
  const workspace = readFileSync(workspaceHandlersPath, "utf8");
  const store = readFileSync(storeStatePath, "utf8");

  const invoke = parseQuotedList(preload, "localAgentModeSessionInvoke");
  const residualKeys = parseSecuredHandlerKeys(residual);
  const coreKeys = parseReturnObjectKeys(cowork, "createCoworkSessionHandlers");
  const workspaceKeys = parseReturnObjectKeys(
    workspace,
    "createCoworkSessionWorkspaceHandlers",
  );
  const overrideKeys = parseRegisterOverrideKeys(cowork);

  const registered = new Set([
    ...coreKeys,
    ...workspaceKeys,
    ...residualKeys,
    ...overrideKeys,
  ]);
  if (hasLocalAgentStore(store, "interactiveAuth")) {
    registered.add("interactiveAuth_$store$_getState");
  }
  if (hasLocalAgentStore(store, "sessionsBridgeStatus")) {
    registered.add("sessionsBridgeStatus_$store$_getState");
  }

  it("preload lists a stable invoke surface", () => {
    expect(invoke.length).toBeGreaterThanOrEqual(60);
    expect(new Set(invoke).size).toBe(invoke.length);
  });

  it("every preload invoke has a registered handler owner", () => {
    const missing = invoke.filter((method) => !registered.has(method));
    expect(missing).toEqual([]);
  });

  it("product-delta methods stay on residual/override/store (honest deny path)", () => {
    for (const method of PRODUCT_DELTA_HONEST) {
      expect(invoke).toContain(method);
      expect(registered.has(method)).toBe(true);
    }
    // Bridge + interactive auth mutations live in residual file (not soft-true core).
    expect(residualKeys).toEqual(
      expect.arrayContaining([
        "getBridgeConsent",
        "kickBridgePoll",
        "triggerInteractiveAuth",
        "revokeInteractiveAuth",
        "authorizeDirectMcpServer",
        "getDirectMcpServerStatuses",
      ]),
    );
    expect(overrideKeys).toEqual(
      expect.arrayContaining([
        "getSessionsBridgeEnabled",
        "setSessionsBridgeEnabled",
        "sessionsBridgeStatus_$store$_getState",
      ]),
    );
    expect(hasLocalAgentStore(store, "interactiveAuth")).toBe(true);
  });

  it("store residual comments forbid invent OAuth / use yit status", () => {
    expect(store).toMatch(/storeName: "interactiveAuth"/);
    expect(store).toMatch(/getState: \(\) => null/);
    expect(store).toMatch(/getSessionsBridgeStatusState/);
    // Official QcA — no invent reason/status fields in store residual.
    expect(store).not.toMatch(/sessions_bridge_unavailable/);
  });

  it("bridge override uses official custom-3p residual shapes (source lock)", () => {
    expect(cowork).toMatch(/getSessionsBridgeEnabled/);
    expect(cowork).toMatch(/getSessionsBridgeStatusState/);
    expect(cowork).toMatch(/setSessionsBridgeEnabled/);
    // Official yit/QcA — no invent unavailable bag.
    expect(cowork).not.toMatch(/sessions_bridge_unavailable/);
    expect(cowork).not.toMatch(/status: "unavailable"/);
  });
});
