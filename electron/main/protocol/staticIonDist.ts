import { app, net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_HOST } from "./constants";
import { buildAppContentSecurityPolicy, extractInlineScriptHashes } from "./csp";
import { resolveInsideRoot } from "./safePath";
import { SettingsStore } from "../services/settings/settingsStore";
import { resolveDialogLocale } from "../services/settings/desktopDialogI18n";

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
 * Residual ion SPA locale bootstrap (index-BELzQL5P):
 *   const l3t="spa:locale", c3t=a_([localStorage.getItem(l3t), ...navigator.languages])
 *   document.documentElement.lang=c3t
 * Product DesktopIntl preference must win over OS language for setup-desktop-3p.
 * Inject a first inline script + lang so c3t resolves before module graph runs.
 * CSP hashes recomputed from the modified HTML (extractInlineScriptHashes).
 */
function resolvePreferredSpaLocale(): string {
  try {
    const prefs = new SettingsStore().getPreferences();
    const raw =
      typeof prefs.locale === "string" && prefs.locale.length > 0
        ? prefs.locale
        : app.getLocale();
    return resolveDialogLocale(raw);
  } catch {
    return "en-US";
  }
}

function injectSpaLocaleBootstrap(html: string, locale: string): string {
  const safe = locale.replace(/[^A-Za-z0-9-]/g, "") || "en-US";
  const seed =
    `<script>try{localStorage.setItem("spa:locale",${JSON.stringify(safe)})}catch(e){}</script>`;
  let out = html;
  // Prefer official residual process shim as anchor (always present in ion-dist index).
  const shim =
    '<script>void 0===globalThis.process&&(globalThis.process={env:{},cwd:function(){return"/"}}),void 0===globalThis.global&&(globalThis.global=globalThis)</script>';
  if (out.includes(shim)) {
    out = out.replace(shim, `${shim}${seed}`);
  } else if (out.includes("</head>")) {
    out = out.replace("</head>", `${seed}</head>`);
  } else {
    out = seed + out;
  }
  // lang= is read by some residual paths; keep in sync with spa:locale.
  out = out.replace(/<html\b([^>]*)\blang="[^"]*"/, `<html$1lang="${safe}"`);
  if (!/\blang=/.test(out.slice(0, 200))) {
    out = out.replace("<html", `<html lang="${safe}"`);
  }
  return out;
}

/**
 * Official ion-dist SPA routes (1:1 residual UI + styles — not product approximate).
 * app.asar vgr createSetupWindow → app://localhost/setup-desktop-3p
 * (chunk c71860c77-BOaDa5w5: full categories / className / layout).
 * Product owns configLibrary + Custom3pSetup IPC + multi-vendor bag fields;
 * multi-vendor Connection cards re-applied via patch-setup-multivendor-providers
 * after sync:ion-dist (ion-dist is gitignored wipe).
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
    // Seed spa:locale from DesktopIntl preference so setup-desktop-3p follows multi-language config.
    if (residualSpa) {
      const locale = resolvePreferredSpaLocale();
      const rawHtml = await fs.readFile(residualIndexHtml, "utf8");
      const html = injectSpaLocaleBootstrap(rawHtml, locale);
      const scriptHashes = await extractInlineScriptHashes(html);
      const csp =
        options.csp ??
        buildAppContentSecurityPolicy({ scriptHashes });
      return withContentSecurityPolicy(
        new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        }),
        csp,
      );
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
