import { net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_HOST } from "./constants";
import { buildAppContentSecurityPolicy, extractInlineScriptHashes } from "./csp";
import { resolveInsideRoot } from "./safePath";

export type StaticIonDistOptions = {
  root: string;
  /**
   * Official residual ion-dist for SPA routes that product-web does not ship
   * (setup-desktop-3p / device-code-verify). When set and distinct from `root`,
   * residual paths + missing assets fall through here.
   */
  residualRoot?: string;
  csp?: string;
};

/**
 * Official ion-dist routes that product-web (open-claude-web) does not implement.
 * app.asar vgr createSetupWindow → app://localhost/setup-desktop-3p (ion chunk c71860c77-BOaDa5w5).
 */
export const RESIDUAL_APP_SPA_PATHS = new Set([
  "/setup-desktop-3p",
  "/device-code-verify",
]);

function withContentSecurityPolicy(response: Response, csp: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", csp);
  return new Response(response.body, { status: response.status, headers });
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  // strip trailing slash except root
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function isResidualSpaPath(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return RESIDUAL_APP_SPA_PATHS.has(p);
}

function makeCspLoader(indexHtml: string, optionsCsp?: string): () => Promise<string> {
  let cspPromise: Promise<string> | undefined;
  return () => {
    cspPromise ??= optionsCsp
      ? Promise.resolve(optionsCsp)
      : fs
          .readFile(indexHtml, "utf8")
          .then((html) => extractInlineScriptHashes(html))
          .catch(() => [])
          .then((scriptHashes) => buildAppContentSecurityPolicy({ scriptHashes }));
    return cspPromise;
  };
}

/**
 * Original `hrr(ionDistPath)` equivalent: static file serving + SPA fallback.
 *
 * Product dual-root residual:
 * - Primary `root` = product-web (or ion-dist when product-web absent)
 * - Optional `residualRoot` = official ion-dist for setup-desktop-3p etc.
 * Without residual root, setup window SPA-falls into product task/new shell (wrong window).
 */
export function createStaticIonDistHandler(options: StaticIonDistOptions) {
  const root = path.resolve(options.root);
  const residualRoot =
    options.residualRoot && path.resolve(options.residualRoot) !== root
      ? path.resolve(options.residualRoot)
      : null;

  const primaryIndexHtml = path.join(root, "index.html");
  const residualIndexHtml = residualRoot ? path.join(residualRoot, "index.html") : primaryIndexHtml;
  const primaryIndexUrl = pathToFileURL(primaryIndexHtml).href;
  const residualIndexUrl = pathToFileURL(residualIndexHtml).href;

  const getPrimaryCsp = makeCspLoader(primaryIndexHtml, options.csp);
  const getResidualCsp = makeCspLoader(residualIndexHtml, options.csp);

  return async function handleStaticIonDist(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response(null, { status: 404 });

    const pathname = normalizePathname(url.pathname);
    const residualSpa = isResidualSpaPath(pathname) && residualRoot;

    // Residual SPA routes always use official ion-dist index (has setup-desktop-3p route).
    if (residualSpa) {
      return withContentSecurityPolicy(await net.fetch(residualIndexUrl), await getResidualCsp());
    }

    // Prefer primary file (product-web), then residual ion-dist assets.
    const primaryFile = resolveInsideRoot(root, url.pathname);
    if (primaryFile && (await isFile(primaryFile))) {
      return withContentSecurityPolicy(await net.fetch(pathToFileURL(primaryFile).href), await getPrimaryCsp());
    }

    if (residualRoot) {
      const residualFile = resolveInsideRoot(residualRoot, url.pathname);
      if (residualFile && (await isFile(residualFile))) {
        return withContentSecurityPolicy(
          await net.fetch(pathToFileURL(residualFile).href),
          await getResidualCsp(),
        );
      }
    }

    // Default SPA fallback stays on product shell (main window / task routes).
    return withContentSecurityPolicy(await net.fetch(primaryIndexUrl), await getPrimaryCsp());
  };
}
