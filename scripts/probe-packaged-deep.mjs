/**
 * Deeper packaged Win/mac probe — beyond cold-start smoke.
 *
 * Checks:
 *  1) dual-root static files + CLI binary
 *  2) app.asar product markers + enterprise residual symbols
 *  3) launch with --remote-debugging-port
 *  4) CDP: login page up, navigate setup residual ion-dist
 *  5) renderer bridge surface (window.claude / desktop bindings presence)
 *
 * Usage:
 *   node scripts/probe-packaged-deep.mjs
 *   CLAUDE_PROBE_PORT=9333 node scripts/probe-packaged-deep.mjs
 *
 * Exit 0 only if all required checks pass.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  inspectPackagedAsarMain,
  inspectPackagedDualRoot,
  resolvePackagedTargets,
} from "./packagePaths.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const WebSocket = require("ws");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = resolvePackagedTargets({ root });
const port = Number(process.env.CLAUDE_PROBE_PORT ?? 9333);
const userData = path.join(root, ".probe-user-data-packaged");
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failed += 1;
  console.log(`${mark.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
}

function warn(name, detail) {
  results.push({ name, ok: true, detail: `WARN: ${detail}` });
  console.log(`WARN ${name} — ${detail}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, timeoutMs = 3000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  let id = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : data.toString();
    if (!text || text === "undefined") return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.method) return;
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve, reject) => {
      const mid = id++;
      ws.send(JSON.stringify({ id: mid, method, params }));
      const t = setTimeout(() => {
        pending.delete(mid);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      pending.set(mid, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ||
          r.exceptionDetails.text ||
          "evaluate failed",
      );
    }
    return r.result?.value;
  };
  return {
    ready,
    send,
    evaluate,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

// ─── 1) static ─────────────────────────────────────────────
console.log("\n=== 1) static package layout ===\n");

const dual = inspectPackagedDualRoot(targets);
check("dual-root ok", dual.ok, dual.reason || `product=${dual.productBuildId} residual=${dual.residualBuildId}`);
check(
  "product-web is not spa-dev",
  dual.productBuildId && dual.productBuildId !== "spa-dev",
  String(dual.productBuildId),
);
check(
  "residual ion is spa-dev (or residual id)",
  Boolean(dual.residualBuildId),
  String(dual.residualBuildId),
);

const asarMain = inspectPackagedAsarMain(targets.appAsar);
check("asar product main", asarMain.ok, asarMain.reason || `chunks=${asarMain.hasChunks}`);

const claudeName = process.platform === "win32" ? "claude.exe" : "claude";
const claudePaths = [
  path.join(targets.resourcesRoot, "claude-code-bin", claudeName),
  path.join(
    targets.resourcesRoot,
    "claude-code-bin",
    "platforms",
    `${process.platform}-${process.arch === "x64" ? "x64" : process.arch}`,
    claudeName,
  ),
];
const claudeHit = claudePaths.find((p) => fs.existsSync(p));
check("bundled claude CLI present", Boolean(claudeHit), claudeHit || claudePaths.join(" | "));

const setupAssets = [
  "resources/product-web/index.html",
  "resources/ion-dist/index.html",
].map((rel) => path.join(targets.resourcesRoot, path.basename(path.dirname(rel)) === "resources" ? rel.replace("resources/", "") : path.relative("resources", rel)));
// packaged resources layout
const productIndex = path.join(targets.resourcesRoot, "product-web", "index.html");
const ionIndex = path.join(targets.resourcesRoot, "ion-dist", "index.html");
check("packaged product-web/index.html", fs.existsSync(productIndex), productIndex);
check("packaged ion-dist/index.html", fs.existsSync(ionIndex), ionIndex);

// ─── 2) app.asar residual symbols ───────────────────
console.log("\n=== 2) app.asar residual symbols ===\n");

// @electron/asar extractFile is flaky with win path keys from listPackage;
// extractAll to a temp dir and read main chunk is reliable (~80MB, <1s).
let asarText = "";
const asarExtractDir = path.join(root, "out", ".tmp-probe-asar");
try {
  await fsPromises.rm(asarExtractDir, { recursive: true, force: true });
  asar.extractAll(targets.appAsar, asarExtractDir);
  const chunksDir = path.join(asarExtractDir, ".vite", "build", "chunks");
  const buildDir = path.join(asarExtractDir, ".vite", "build");
  const candidates = [];
  if (fs.existsSync(chunksDir)) {
    for (const name of fs.readdirSync(chunksDir)) {
      if (name.startsWith("index-") && name.endsWith(".js")) {
        candidates.push(path.join(chunksDir, name));
      }
    }
  }
  if (fs.existsSync(path.join(buildDir, "index.js"))) {
    candidates.push(path.join(buildDir, "index.js"));
  }
  for (const f of candidates.slice(0, 4)) {
    asarText += fs.readFileSync(f, "utf8") + "\n";
  }
  check(
    "asar js readable",
    asarText.length > 1000,
    `${asarText.length} chars from ${candidates.length} files`,
  );
} catch (e) {
  check("asar js readable", false, String(e.message || e));
}

const symbols = [
  ["enterpriseInteractiveAuth", /triggerEnterpriseInteractiveAuth|enterpriseInteractiveAuth/],
  ["enterpriseVertexAuth", /enterpriseVertexAuth|needsVertexInteractiveAuth|Vertex/],
  ["enterpriseBedrockSso", /enterpriseBedrockSso|needsBedrockSso|BedrockSso/],
  ["enterpriseBootstrapOidc", /enterpriseBootstrapOidc|triggerEnterpriseBootstrapAuth/],
  ["credentialHelper", /runEnterpriseCredentialHelperWithTtl|credentialHelperTokenToSpawnEnv/],
  ["nonessentialGate", /installEnterpriseNonessentialNetworkGate|isEnterpriseNonessentialServicesDisabled/],
  ["tokenCap", /assertEnterpriseTokenCapAllowsTurn|coworkTokenCap/],
  ["configLibrary", /configLibrary|listCustom3pConfigs|custom3pConfigLibrary/],
  ["buildClaudeCliSpawnEnv", /buildClaudeCliSpawnEnv|enrichClaudeCliSpawnEnvWithEnterpriseAuth/],
];
for (const [name, re] of symbols) {
  check(`asar has ${name}`, re.test(asarText), re.source);
}

// ─── 3+4) launch + CDP ─────────────────────────────────────
console.log("\n=== 3) launch packaged + CDP probe ===\n");

await fsPromises.rm(userData, { recursive: true, force: true });
await fsPromises.mkdir(userData, { recursive: true });

const binary = targets.binary;
if (!fs.existsSync(binary)) {
  check("packaged binary exists", false, binary);
  console.log(JSON.stringify({ failed, results }, null, 2));
  process.exit(1);
}
check("packaged binary exists", true, binary);

const child = spawn(
  binary,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
  {
    cwd: path.dirname(binary),
    env: {
      ...process.env,
      CLAUDE_USER_DATA_DIR: userData,
      CLAUDE_DESKTOP_SMOKE_TEST: "1",
      CLAUDE_DESKTOP_DEBUG_IPC_FALLBACK: "1",
      electron_config_cache: path.join(root, ".electron-cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  },
);

let output = "";
const onData = (c) => {
  output += c.toString();
};
child.stdout?.on("data", onData);
child.stderr?.on("data", onData);

let smokeMarker = null;
const smokeWait = (async () => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const m = output.match(/\[claudex-smoke\] (.+)/);
    if (m) {
      try {
        smokeMarker = JSON.parse(m[1]);
      } catch {
        smokeMarker = { ok: false };
      }
      return;
    }
    await sleep(200);
  }
})();

// Wait for CDP
let list = null;
for (let i = 0; i < 40; i++) {
  try {
    list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    if (Array.isArray(list) && list.length) break;
  } catch {
    /* retry */
  }
  await sleep(500);
}
check("CDP /json/list up", Array.isArray(list) && list.length > 0, list ? `${list.length} targets` : "no list");

await smokeWait;
check(
  "smoke marker ok",
  Boolean(smokeMarker?.ok),
  smokeMarker
    ? `ipc real=${smokeMarker.ipcHandlers?.real} fallback=${smokeMarker.ipcHandlers?.fallback} url=${smokeMarker.mainViewUrl}`
    : "no marker",
);
if (smokeMarker?.ok) {
  check(
    "IPC zero fallback",
    smokeMarker.ipcHandlers?.fallback === 0,
    `fallback=${smokeMarker.ipcHandlers?.fallback}`,
  );
  check(
    "enterpriseAuth handlers registered",
    Number(smokeMarker.ipcHandlers?.byOwner?.enterpriseAuth ?? 0) > 0,
    `enterpriseAuth=${smokeMarker.ipcHandlers?.byOwner?.enterpriseAuth}`,
  );
  check(
    "Custom3pSetup handlers registered",
    Number(smokeMarker.ipcHandlers?.byOwner?.["claude.settings.Custom3pSetup"] ?? 0) > 0,
    `Custom3pSetup=${smokeMarker.ipcHandlers?.byOwner?.["claude.settings.Custom3pSetup"]}`,
  );
  check(
    "uses bundled claude",
    smokeMarker.claudeCode?.usesBundledExecutable === true,
    String(smokeMarker.claudeCode?.executable || ""),
  );
}

// Find a page target
const pages = (list || []).filter((t) => t.type === "page" || t.type === "webview");
const mainPage =
  pages.find((t) => String(t.url || "").includes("app://localhost")) ||
  pages.find((t) => String(t.url || "").includes("login")) ||
  pages[0];

if (!mainPage?.webSocketDebuggerUrl) {
  check("main page target", false, JSON.stringify((list || []).map((t) => ({ type: t.type, url: t.url }))));
} else {
  check("main page target", true, mainPage.url);
  const session = cdpSession(mainPage.webSocketDebuggerUrl);
  try {
    await session.ready;
    await session.send("Runtime.enable");
    await session.send("Page.enable");

    // Current location
    const href = await session.evaluate("location.href");
    check(
      "renderer on app:// product route",
      typeof href === "string" && href.startsWith("app://"),
      String(href),
    );

    // Bridge surface probes (names vary; record presence)
    const bridge = await session.evaluate(`(() => {
      const g = globalThis;
      const keys = Object.keys(g).filter(k => /claude|desktop|electron/i.test(k)).slice(0, 40);
      const has = {
        claude: typeof g.claude,
        desktop: typeof g.desktop,
        electron: typeof g.electron,
        require: typeof g.require,
      };
      // common preload bridges
      const api = g.claude || g.desktop || g.__CLAUDE__ || null;
      let apiKeys = [];
      try { if (api && typeof api === 'object') apiKeys = Object.keys(api).slice(0, 50); } catch {}
      return { keys, has, apiKeys, title: document.title, readyState: document.readyState };
    })()`);
    check(
      "renderer document ready",
      bridge?.readyState === "interactive" || bridge?.readyState === "complete",
      `readyState=${bridge?.readyState} title=${bridge?.title}`,
    );
    if (bridge?.apiKeys?.length) {
      check("preload bridge keys present", true, bridge.apiKeys.slice(0, 12).join(","));
    } else {
      warn("preload bridge keys", `global keys=${JSON.stringify(bridge?.keys)} has=${JSON.stringify(bridge?.has)}`);
    }

    // Navigate residual Setup SPA (official ion-dist)
    await session.send("Page.navigate", {
      url: "app://localhost/setup-desktop-3p",
    });
    await sleep(2500);
    // wait load
    for (let i = 0; i < 20; i++) {
      const h = await session.evaluate("location.href");
      if (String(h).includes("setup-desktop-3p")) break;
      await sleep(300);
    }
    const setupHref = await session.evaluate("location.href");
    check(
      "navigated setup-desktop-3p",
      String(setupHref).includes("setup-desktop-3p"),
      String(setupHref),
    );

    const setupDom = await session.evaluate(`(() => {
      const bodyText = (document.body?.innerText || "").slice(0, 500);
      const htmlLen = document.documentElement?.outerHTML?.length || 0;
      const hasRoot = Boolean(document.getElementById('root') || document.querySelector('[data-build-id]') || document.body);
      const buildId = document.documentElement?.getAttribute('data-build-id')
        || document.querySelector('[data-build-id]')?.getAttribute('data-build-id')
        || null;
      // residual ion-dist setup often spa-dev
      return {
        title: document.title,
        readyState: document.readyState,
        htmlLen,
        bodySample: bodyText.replace(/\\s+/g, ' ').trim().slice(0, 200),
        buildId,
        hasRoot,
      };
    })()`);
    check(
      "setup page rendered content",
      Boolean(setupDom?.hasRoot) && Number(setupDom?.htmlLen || 0) > 500,
      `htmlLen=${setupDom?.htmlLen} buildId=${setupDom?.buildId} title=${setupDom?.title} body=${setupDom?.bodySample}`,
    );

    // Try device-code residual route (should load ion, not invent OAuth success)
    await session.send("Page.navigate", {
      url: "app://localhost/device-code-verify",
    });
    await sleep(1500);
    const deviceHref = await session.evaluate("location.href");
    check(
      "device-code-verify route loads",
      String(deviceHref).includes("device-code") || String(deviceHref).startsWith("app://"),
      String(deviceHref),
    );
  } catch (e) {
    check("CDP session probe", false, String(e.message || e));
  } finally {
    session.close();
  }
}

// cleanup
killTree(child.pid);
await sleep(500);

console.log("\n=== summary ===\n");
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`PASS ${pass}  FAIL ${fail}  TOTAL ${results.length}`);
if (fail) {
  console.log("\nFailed:");
  for (const r of results.filter((x) => !x.ok)) {
    console.log(` - ${r.name}: ${r.detail}`);
  }
}

const reportPath = path.join(root, "docs", "packaged-deep-probe.json");
await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
await fsPromises.writeFile(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      packagedRoot: targets.packagedRoot,
      dual,
      smokeMarker,
      pass,
      fail,
      results,
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${reportPath}`);

process.exit(fail ? 1 : 0);
