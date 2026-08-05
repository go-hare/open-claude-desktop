/**
 * Official Jn residual (app.asar):
 *   let dH; function Jn(){ if(dH!==void 0)return dH;
 *     try{ dH=require("@ant/claude-native") }catch{ dH=null }
 *     return dH }
 *   Su() = Jn() or throw "claude-native failed to load…"
 *
 * Product: load from original-runtime-node_modules (same roots as claude-swift).
 * Never invents keys/mouse success when the .node is missing.
 */
import { app } from "electron";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { configureOriginalRuntimeModules } from "../originalRuntime/originalRuntimeModules";

/**
 * Minimal surface used by official createDarwinExecutor (cTi)
 * + GrandPrix Jn residual attestedMachRequest.
 */
export type ClaudeNativeAddon = {
  keys?: (parts: string[]) => Promise<void> | void;
  typeText?: (text: string) => Promise<void> | void;
  mouseButton?: (
    button: "left" | "right" | "middle" | string,
    action: "click" | "press" | "release" | string,
    count?: number,
  ) => Promise<void> | void;
  mouseScroll?: (
    amount: number,
    axis: "vertical" | "horizontal" | string,
  ) => Promise<void> | void;
  moveMouse?: (
    x: number,
    y: number,
    animate?: boolean,
  ) => Promise<void> | void;
  mouseLocation?: () =>
    | Promise<{ x: number; y: number }>
    | { x: number; y: number };
  key?: (
    name: string,
    action: "press" | "release" | string,
  ) => Promise<void> | void;
  getFrontmostAppInfo?: () =>
    | { bundleId?: string; appName?: string }
    | null
    | undefined;
  cuGetOwnBundleId?: () => string | undefined;
  promptWindowsHello?: (message: string) => Promise<boolean>;
  getHcsStatus?: () => { available: boolean; missingServices: string[] };
  enableWindowsOptionalFeature?: (
    name: string,
  ) => Promise<{ success: boolean; exitCode?: number }>;
  /**
   * Official Jn / nvi residual for GrandPrix pairing (attested_mach.rs).
   * Present on real claude-native-binding.node — never invent success.
   */
  attestedMachRequest?: (
    service: string,
    teamId: string,
    body: Buffer,
  ) => Promise<{
    ok: boolean;
    body?: Buffer | Uint8Array | null;
    error?: string;
  }>;
};

let cached: ClaudeNativeAddon | null | undefined;

function runtimeRoots(): string[] {
  return [
    process.env.CLAUDE_ORIGINAL_RUNTIME_NODE_MODULES,
    process.resourcesPath
      ? path.join(
          process.resourcesPath,
          "original-runtime-node_modules",
          "node_modules",
        )
      : null,
    app.isPackaged
      ? null
      : path.join(
          app.getAppPath(),
          "resources",
          "original-runtime-node_modules",
          "node_modules",
        ),
    path.join(app.getAppPath(), "node_modules"),
    path.resolve(
      process.cwd(),
      "resources/original-runtime-node_modules/node_modules",
    ),
  ].filter((v): v is string => Boolean(v));
}

function isUsableNative(mod: unknown): mod is ClaudeNativeAddon {
  if (!mod || typeof mod !== "object") return false;
  // Proxy placeholder from vendor/ant/claude-native throws on member call —
  // require a real CU or attestedMach entrypoint (not empty invent object).
  const candidate = mod as ClaudeNativeAddon;
  return (
    typeof candidate.keys === "function" ||
    typeof candidate.mouseButton === "function" ||
    typeof candidate.typeText === "function" ||
    typeof candidate.attestedMachRequest === "function"
  );
}

/**
 * Official Jn residual. Returns null on missing binary / load failure.
 * Caches success and failure for process lifetime unless forceReload.
 */
export function maybeGetClaudeNative(
  options: { forceReload?: boolean } = {},
): ClaudeNativeAddon | null {
  if (!options.forceReload && cached !== undefined) return cached;
  try {
    configureOriginalRuntimeModules();
    let mod: unknown = null;
    for (const root of runtimeRoots()) {
      const pkgJson = path.join(root, "@ant/claude-native", "package.json");
      if (!fs.existsSync(pkgJson)) continue;
      const nodePath = path.join(
        root,
        "@ant/claude-native",
        "claude-native-binding.node",
      );
      if (!fs.existsSync(nodePath)) {
        console.warn("[claudeNativeAddon] claude-native-binding.node missing under", root);
        continue;
      }
      try {
        const runtimeRequire = createRequire(pkgJson);
        mod = runtimeRequire(path.dirname(pkgJson));
        break;
      } catch (error) {
        console.warn("[claudeNativeAddon] require failed", root, error);
      }
    }
    if (!mod) {
      try {
        const fallbackRequire = createRequire(
          path.join(app.getAppPath(), "package.json"),
        );
        mod = fallbackRequire("@ant/claude-native");
      } catch (error) {
        console.warn("[claudeNativeAddon] fallback @ant/claude-native failed", error);
        cached = null;
        return null;
      }
    }
    const candidate =
      mod &&
      typeof mod === "object" &&
      "default" in (mod as object) &&
      (mod as { default: unknown }).default
        ? (mod as { default: unknown }).default
        : mod;
    if (!isUsableNative(candidate)) {
      console.warn(
        "[claudeNativeAddon] loaded module missing keys/mouseButton/typeText",
      );
      cached = null;
      return null;
    }
    cached = candidate;
    return candidate;
  } catch (error) {
    console.warn("[claudeNativeAddon] load failed", error);
    cached = null;
    return null;
  }
}

/** Official Su residual — throw when native unavailable. */
export function requireClaudeNative(): ClaudeNativeAddon {
  const native = maybeGetClaudeNative();
  if (!native) {
    throw new Error(
      "claude-native failed to load. Computer control is not available.",
    );
  }
  return native;
}

/** Test helper — clear process cache. */
export function resetClaudeNativeAddonForTests(): void {
  cached = undefined;
}
