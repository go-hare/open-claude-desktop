/**
 * Product extension: optional HTTP(S) proxy fields on setup-desktop-3p Connection form.
 *
 * Official residual has no proxy inputs. Bag-mode CLI spawn + main health probe need
 * them when the gateway is only reachable via a local forwarder (e.g. 127.0.0.1:12000).
 *
 * Dual-root packaging note (critical):
 *   app:// prefers product-web assets over residual ion-dist for shared chunks.
 *   Setup SPA route uses residual index.html, but `assets/v1/c71860c77-*.js` is often
 *   served from product-web when that tree has the same filename. Patch BOTH:
 *     - resources/ion-dist/assets/v1/c71860c77-BOaDa5w5.js
 *     - resources/product-web/assets/v1/c71860c77-BOaDa5w5.js
 *   (and open-claude-web public/dist mirrors when present).
 *
 * Fields (electron/main/services/custom3p/custom3pCliEnv.ts):
 *   inferenceHttpProxy  → HTTP_PROXY  (+ HTTPS_PROXY default when https empty)
 *   inferenceHttpsProxy → HTTPS_PROXY
 *   inferenceNoProxy    → NO_PROXY (host list)
 *
 * Form placement (residual Setup render):
 *   fe = schema keys with matching provider → single "{Provider} credentials" card
 *   me = schema keys with NO provider → group cards via ut.group
 *   So schema fields MUST omit provider:"gateway"; set ut.group = "Network proxy".
 *
 * Idempotent. Migrates older product v1 patches that used provider:"gateway".
 */
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "./originalAppPaths.mjs";

const root = getProjectRoot();

const SETUP_PATHS = [
  path.join(root, "resources/ion-dist/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "resources/product-web/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "..", "open-claude-web", "public/assets/v1/c71860c77-BOaDa5w5.js"),
  path.join(root, "..", "open-claude-web", "dist/assets/v1/c71860c77-BOaDa5w5.js"),
];

/** Insert after gateway headers Ye(...), before inferenceVertexProjectId. Title may be EN or localized. */
const SCHEMA_HEADERS_RE =
  /(inferenceGatewayHeaders:Ye\(Ge\.optional\(\),\{scopes:\["3p","3p-bootstrap"\],provider:"gateway",title:"[^"]+",sensitive:"presence"\}\),)(inferenceVertexProjectId:)/;

const SCHEMA_PROXY =
  'inferenceHttpProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],' +
  'title:"HTTP proxy",sensitive:"hostname"}),' +
  'inferenceHttpsProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],' +
  'title:"HTTPS proxy",sensitive:"hostname"}),' +
  'inferenceNoProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],' +
  'title:"No proxy hosts",sensitive:"hostname"}),';

/** Older product patch — provider-gated; residual ignores group and buries under GATEWAY credentials. */
const SCHEMA_PROXY_V1 =
  'inferenceHttpProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"gateway",' +
  'title:"HTTP proxy",sensitive:"hostname"}),' +
  'inferenceHttpsProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"gateway",' +
  'title:"HTTPS proxy",sensitive:"hostname"}),' +
  'inferenceNoProxy:Ye(r().optional(),{scopes:["3p","3p-bootstrap"],provider:"gateway",' +
  'title:"No proxy hosts",sensitive:"hostname"}),';

const SCHEMA_PROXY_V2 = SCHEMA_PROXY;

const UT_HEADERS_RE =
  /(static entries \(helper wins on conflict\)\."\}\},)(inferenceVertexProjectId:)/;

const UT_PROXY =
  'inferenceHttpProxy:{category:"connection",group:"Network proxy",order:10,' +
  'placeholder:"http://127.0.0.1:12000",' +
  'hint:"Optional outbound HTTP proxy for CLI spawn + health probe (HTTP_PROXY). Leave empty for direct."},' +
  'inferenceHttpsProxy:{category:"connection",group:"Network proxy",order:11,' +
  'placeholder:"http://127.0.0.1:12000",' +
  'hint:"Optional outbound HTTPS proxy (HTTPS_PROXY). When empty, HTTP proxy is reused."},' +
  'inferenceNoProxy:{category:"connection",group:"Network proxy",order:12,' +
  'placeholder:"127.0.0.1,localhost",' +
  'hint:"Comma-separated hosts that bypass the proxy (NO_PROXY). Host list, not a proxy URL."},';

function patchSetup(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn("setup proxy skip (missing):", filePath);
    return false;
  }
  let t = fs.readFileSync(filePath, "utf8");
  let changed = false;

  if (t.includes(SCHEMA_PROXY_V1)) {
    t = t.replace(SCHEMA_PROXY_V1, SCHEMA_PROXY_V2);
    changed = true;
    console.log("migrated setup proxy schema v1→v2", filePath);
  }

  if (!t.includes("inferenceHttpProxy")) {
    if (!SCHEMA_HEADERS_RE.test(t)) {
      throw new Error(`schema proxy anchor not found in ${filePath}`);
    }
    t = t.replace(SCHEMA_HEADERS_RE, `$1${SCHEMA_PROXY}$2`);
    if (!UT_HEADERS_RE.test(t)) {
      throw new Error(`ut proxy form meta anchor not found in ${filePath}`);
    }
    t = t.replace(UT_HEADERS_RE, `$1${UT_PROXY}$2`);
    changed = true;
    console.log("patched setup proxy fields", filePath);
  } else if (!t.includes('group:"Network proxy"')) {
    if (!UT_HEADERS_RE.test(t)) {
      throw new Error(`ut proxy form meta anchor not found in ${filePath}`);
    }
    t = t.replace(UT_HEADERS_RE, `$1${UT_PROXY}$2`);
    changed = true;
    console.log("patched setup proxy ut meta", filePath);
  } else if (!changed) {
    console.log("setup proxy already patched (v2)", filePath);
  }

  if (changed) {
    fs.writeFileSync(filePath, t, "utf8");
  }

  // Sanity
  const out = fs.readFileSync(filePath, "utf8");
  if (
    !out.includes("inferenceHttpProxy") ||
    !out.includes("inferenceHttpsProxy") ||
    !out.includes("inferenceNoProxy") ||
    !out.includes('group:"Network proxy"')
  ) {
    throw new Error(`setup proxy patch sanity failed: ${filePath}`);
  }
  if (out.includes(SCHEMA_PROXY_V1)) {
    throw new Error(`setup proxy still on v1 (provider-gated): ${filePath}`);
  }
  return true;
}

function main() {
  let any = false;
  for (const p of SETUP_PATHS) {
    try {
      if (patchSetup(p)) any = true;
    } catch (e) {
      // Optional web mirrors may have different residual hashes.
      if (p.includes(`${path.sep}open-claude-web${path.sep}`)) {
        console.warn("web setup proxy skip:", e instanceof Error ? e.message : String(e));
        continue;
      }
      throw e;
    }
  }
  if (!any) {
    console.warn("no setup files patched (all missing?)");
  }
  console.log("OK setup proxy fields");
}

main();
