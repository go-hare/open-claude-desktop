/**
 * Product bridge: apply configLibrary inferenceHttp(s)Proxy to Electron sessions
 * that load renderer / artifact-sandbox traffic.
 *
 * Why:
 *   - Official residual MermaidIframe (index-BELzQL5P `eit`) loads
 *     https://www.claudeusercontent.com in an iframe on the main view session.
 *   - CLI spawn already gets HTTP(S)_PROXY via buildCustom3pProxySpawnEnv.
 *   - Health probes use a temp partition + setProxy (custom3pConfigHealth).
 *   - Chromium renderer traffic does NOT honor process.env HTTP_PROXY — without
 *     session.setProxy the artifact sandbox fails (chrome-error://) and the
 *     diagram stays on "Rendering diagram...".
 *
 * Scope:
 *   - defaultSession (main product SPA / WebContentsView)
 *   - persist:artifact-sandbox (coworkArtifactViewManager residual partition)
 * Does not invent a local mermaid renderer; only opens the network path official
 * residual already uses.
 */

import { session } from "electron";
import {
  buildCustom3pElectronProxyConfig,
  custom3pEnterpriseConfigFromUnknown,
  type Custom3pEnterpriseConfig,
} from "../custom3p/custom3pCliEnv";
import { getAppliedCustom3pConfigLibraryBag } from "../custom3p/custom3pConfigLibrary";
import { resolveDeploymentModeFromUserData } from "../custom3p/deploymentMode";

/** Sessions that load product UI or official artifact-sandbox hosts. */
const RENDERER_SESSION_PARTITIONS = [
  undefined, // defaultSession
  "persist:artifact-sandbox",
] as const;

/**
 * Always bypass loopback so MAIN_VIEW (127.0.0.1:5176) and local CDP/health stay
 * direct even when bag inferenceNoProxy only lists a single host.
 */
function mergeProxyBypassRules(bagNoProxy?: string | null): string {
  const required = ["<local>", "localhost", "127.0.0.1", "[::1]"];
  const fromBag = (bagNoProxy ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const host of [...required, ...fromBag]) {
    const key = host.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(host);
  }
  return out.join(",");
}

export type ApplyRendererProxyResult = {
  applied: boolean;
  proxyRules: string | null;
  proxyBypassRules: string | null;
  mode: "fixed_servers" | "direct" | "system";
  source: "configLibrary" | "dotClaude" | "none";
};

function proxyConfigFromBag(
  bag: Record<string, unknown> | Custom3pEnterpriseConfig | null | undefined,
): ReturnType<typeof buildCustom3pElectronProxyConfig> {
  if (!bag) return null;
  const enterprise =
    "inferenceProvider" in bag || "inferenceHttpProxy" in bag
      ? custom3pEnterpriseConfigFromUnknown(bag) ??
        (bag as Custom3pEnterpriseConfig)
      : custom3pEnterpriseConfigFromUnknown(bag);
  return buildCustom3pElectronProxyConfig(enterprise);
}

/**
 * Apply bag proxy (or restore OS system proxy when bag has none) on product
 * renderer sessions. Safe to call repeatedly after Setup write/apply without relaunch.
 */
export async function applyRendererSessionProxy(
  config: Custom3pEnterpriseConfig | Record<string, unknown> | null | undefined,
): Promise<ApplyRendererProxyResult> {
  const proxy = proxyConfigFromBag(config ?? null);

  const sessions: Electron.Session[] = [];
  for (const partition of RENDERER_SESSION_PARTITIONS) {
    try {
      sessions.push(
        partition === undefined
          ? session.defaultSession
          : session.fromPartition(partition),
      );
    } catch (error) {
      console.warn(
        "[proxy] failed to resolve session partition",
        partition ?? "default",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (!proxy) {
    await Promise.all(
      sessions.map(async (ses) => {
        try {
          // No bag inferenceHttp(s)Proxy: follow OS / IE system proxy (Windows
          // ProxyEnable), not force direct. Forced direct previously broke 1p
          // claude.ai loads when egress IP is region-blocked but system proxy
          // reaches an allowed CF POP (app-unavailable-in-region → about:blank).
          // Clearing a stale fixed_servers override still happens — mode:system
          // replaces it. Official Electron default without setProxy is system.
          await ses.setProxy({ mode: "system" });
          if (typeof ses.forceReloadProxyConfig === "function") {
            await ses.forceReloadProxyConfig();
          }
        } catch (error) {
          console.warn(
            "[proxy] restore system renderer proxy failed",
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
    return {
      applied: false,
      proxyRules: null,
      proxyBypassRules: null,
      mode: "system",
      source: "none",
    };
  }

  await Promise.all(
    sessions.map(async (ses) => {
      try {
        const proxyBypassRules = mergeProxyBypassRules(proxy.proxyBypassRules);
        await ses.setProxy({
          mode: proxy.mode,
          proxyRules: proxy.proxyRules,
          proxyBypassRules,
        });
        if (typeof ses.forceReloadProxyConfig === "function") {
          await ses.forceReloadProxyConfig();
        }
      } catch (error) {
        console.warn(
          "[proxy] set renderer proxy failed",
          proxy.proxyRules,
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );

  const proxyBypassRules = mergeProxyBypassRules(proxy.proxyBypassRules);
  console.info(
    "[proxy] renderer sessions →",
    proxy.proxyRules,
    proxyBypassRules,
  );

  return {
    applied: true,
    proxyRules: proxy.proxyRules,
    proxyBypassRules,
    mode: "fixed_servers",
    source: "configLibrary",
  };
}

/**
 * Resolve applied bag / dotClaude proxy fields from userData and apply.
 * Call after app.whenReady() and before mainView loads external iframes.
 */
export async function applyRendererProxyFromUserData(
  userDataPath: string,
): Promise<ApplyRendererProxyResult> {
  try {
    const snapshot = resolveDeploymentModeFromUserData(userDataPath);
    if (snapshot.resolution.mode === "dotClaude") {
      // Product: ~/.claude env may declare HTTP_PROXY; Chromium still needs setProxy.
      // Map detected env through the same bag shape without inventing keys.
      const envProxyHttp =
        process.env.HTTPS_PROXY?.trim() ||
        process.env.HTTP_PROXY?.trim() ||
        process.env.https_proxy?.trim() ||
        process.env.http_proxy?.trim();
      const envNoProxy =
        process.env.NO_PROXY?.trim() || process.env.no_proxy?.trim();
      if (envProxyHttp) {
        const result = await applyRendererSessionProxy({
          inferenceHttpProxy: envProxyHttp,
          inferenceHttpsProxy:
            process.env.HTTPS_PROXY?.trim() ||
            process.env.https_proxy?.trim() ||
            envProxyHttp,
          inferenceNoProxy: envNoProxy,
        });
        return { ...result, source: result.applied ? "dotClaude" : "none" };
      }
      const cleared = await applyRendererSessionProxy(null);
      return { ...cleared, source: "dotClaude" };
    }

    const bag =
      (snapshot.appliedConfig as Record<string, unknown> | null) ??
      getAppliedCustom3pConfigLibraryBag(userDataPath);
    const result = await applyRendererSessionProxy(bag);
    return {
      ...result,
      source: result.applied ? "configLibrary" : "none",
    };
  } catch (error) {
    console.warn(
      "[proxy] applyRendererProxyFromUserData failed",
      error instanceof Error ? error.message : String(error),
    );
    return {
      applied: false,
      proxyRules: null,
      proxyBypassRules: null,
      mode: "system",
      source: "none",
    };
  }
}
