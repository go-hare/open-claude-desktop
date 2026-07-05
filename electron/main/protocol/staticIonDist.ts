import { net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_HOST } from "./constants";
import { buildAppContentSecurityPolicy, extractInlineScriptHashes } from "./csp";
import { resolveInsideRoot } from "./safePath";

export type StaticIonDistOptions = {
  root: string;
  csp?: string;
};

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

/** Original `hrr(ionDistPath)` equivalent: static file serving + SPA fallback. */
export function createStaticIonDistHandler(options: StaticIonDistOptions) {
  const root = path.resolve(options.root);
  const indexHtml = path.join(root, "index.html");
  const indexUrl = pathToFileURL(indexHtml).href;
  let cspPromise: Promise<string> | undefined;

  const getCsp = () => {
    cspPromise ??= options.csp
      ? Promise.resolve(options.csp)
      : fs
          .readFile(indexHtml, "utf8")
          .then((html) => extractInlineScriptHashes(html))
          .catch(() => [])
          .then((scriptHashes) => buildAppContentSecurityPolicy({ scriptHashes }));
    return cspPromise;
  };

  return async function handleStaticIonDist(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response(null, { status: 404 });

    const filePath = resolveInsideRoot(root, url.pathname);
    if (!filePath) return new Response(null, { status: 403 });

    if (await isFile(filePath)) {
      return withContentSecurityPolicy(await net.fetch(pathToFileURL(filePath).href), await getCsp());
    }

    return withContentSecurityPolicy(await net.fetch(indexUrl), await getCsp());
  };
}
