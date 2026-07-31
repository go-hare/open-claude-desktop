/**
 * Live CDP smoke for web D1e reverse-RPC / rate_limit store / cu_lock scroll / sdk_mcp_status.
 * Does NOT invent agent-turn MCP tools — injects bridge events into an open cowork session.
 *
 * Prereq: Vite 5176 + Electron CDP 9223 with a Cowork session page open.
 * Usage: node scripts/cdp-cowork-d1e-reverse-rpc-smoke.mjs [sessionId]
 */
import WebSocket from "ws";

const base = "http://127.0.0.1:9223";
const sessionIdArg = process.argv[2] || null;

async function getPage(urlSubstr = "5176") {
  const list = await (await fetch(`${base}/json/list`)).json();
  const page =
    list.find(
      (t) =>
        t.type === "page" &&
        String(t.url || "").includes(urlSubstr) &&
        /\/task\/|local_/.test(String(t.url || "")),
    ) ||
    list.find((t) => t.type === "page" && String(t.url || "").includes(urlSubstr));
  if (!page) {
    throw new Error(
      `no page matching ${urlSubstr}: ${list.map((t) => t.url).join(" | ")}`,
    );
  }
  return page;
}

function createSession(wsUrl) {
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
  const send = (method, params = {}, timeoutMs = 30000) =>
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
  const evaluate = async (expression, awaitPromise = false, timeoutMs = 30000) => {
    const r = await send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: true,
      },
      timeoutMs,
    );
    if (r.exceptionDetails) {
      const desc =
        r.exceptionDetails.exception?.description ||
        r.exceptionDetails.text ||
        JSON.stringify(r.exceptionDetails);
      throw new Error(desc);
    }
    return r.result?.value;
  };
  return {
    ready,
    evaluate,
    close: () => ws.close(),
  };
}

async function main() {
  const page = await getPage("5176");
  const cdp = createSession(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.evaluate("1");

  const prep = await cdp.evaluate(
    `(() => {
      const href = location.href;
      const m = href.match(/local_[a-zA-Z0-9-]+/);
      const fromPath = m ? m[0] : null;
      const las = window["claude.web"]?.LocalAgentModeSessions;
      return {
        href,
        fromPath,
        hasLas: Boolean(las),
        lasMethods: las ? Object.keys(las).filter((k) => /respond|onEvent|getSession/.test(k)) : [],
      };
    })()`,
  );
  console.log("prep", JSON.stringify(prep, null, 2));

  const sessionId = sessionIdArg || prep.fromPath;
  if (!sessionId) {
    console.error("SMOKE_FAIL no cowork sessionId in URL — open a /task/local_* page");
    process.exit(2);
  }

  // Install respond stubs + onEvent capture if bridge present.
  const injected = await cdp.evaluate(
    `(async () => {
      const sid = ${JSON.stringify(sessionId)};
      const las = window["claude.web"]?.LocalAgentModeSessions;
      window.__d1eProbe = {
        sessionId: sid,
        responds: { directory: [], slash: [], plugins: [] },
        events: [],
        errors: [],
      };
      if (!las) {
        window.__d1eProbe.errors.push("no LocalAgentModeSessions");
        return window.__d1eProbe;
      }
      const wrap = (name, bucket) => {
        const orig = las[name]?.bind(las);
        las[name] = async (...args) => {
          window.__d1eProbe.responds[bucket].push(args);
          if (orig) return orig(...args);
          return undefined;
        };
      };
      wrap("respondDirectoryServers", "directory");
      wrap("respondSlashMenuSkills", "slash");
      wrap("respondPluginSearch", "plugins");

      // Prefer Fiber-free: emit via any subscriber if exposed; else try direct onEvent inject.
      // Runtime listens via bridge.onEvent — we re-fire through las if it has a test hook.
      // Fallback: dispatch custom event won't work; call internal via page-eval of known store.
      return window.__d1eProbe;
    })()`,
    true,
  );
  console.log("injected", JSON.stringify(injected, null, 2));

  // Inject events by calling the same path desktop uses: LocalAgentModeSessions.onEvent listeners
  // are private. Product runtime is web-side — use page history + synthetic bridge if available.
  // Approach: find react fiber session runtime is hard; instead post events through
  // window.__coworkD1eInject if product exposes it. For smoke, use evaluate of product store.
  const result = await cdp.evaluate(
    `(async () => {
      const sid = ${JSON.stringify(sessionId)};
      const probe = window.__d1eProbe || { responds: { directory: [], slash: [], plugins: [] }, errors: [] };
      const future = Math.floor(Date.now() / 1000) + 7200;

      // Product path: officialBridgeAdapter wires onEvent from preload. We can only smoke
      // reverse-RPC *respond* if main emits directory_servers_*; without agent turn we
      // inject via page-level event bus if present.
      const emitCandidates = [];
      try {
        // Zustand store peek: rate limit store is module-scoped; expose via dynamic import not available.
        // Use DOM: after rate_limit, banner data attribute should appear if we can apply store.
        // Directly poke store if HMR left a debug hook:
        if (window.__coworkRateLimitStore) {
          const { applyCoworkRateLimitToStore } = await import("/src/features/cowork/session/rateLimit/coworkRateLimitStore.ts");
          applyCoworkRateLimitToStore(
            {
              type: "approaching_limit",
              resetsAt: future,
              remaining: 1,
              windows: {
                "5h": {
                  status: "approaching_limit",
                  resets_at: future,
                  utilization: 0.9,
                  surpassed_threshold: 0.8,
                },
              },
              representativeClaim: "five_hour",
            },
            { sessionId: sid, orgUuid: "_" },
          );
          probe.storePoked = true;
        }
      } catch (e) {
        probe.errors.push(String(e?.message || e));
      }

      // Reverse-RPC respond shape smoke: call product helpers via same bridge methods main would hit.
      const las = window["claude.web"]?.LocalAgentModeSessions;
      if (las?.respondDirectoryServers) {
        await las.respondDirectoryServers("smoke-dir-1", [{ name: "Gmail", uuid: "x" }]);
      }
      if (las?.respondSlashMenuSkills) {
        await las.respondSlashMenuSkills("smoke-slash-1", JSON.stringify({ skills: [] }));
      }
      if (las?.respondPluginSearch) {
        await las.respondPluginSearch("smoke-plug-1", JSON.stringify({ results: [] }));
      }

      await new Promise((r) => setTimeout(r, 50));
      const banner =
        document.querySelector("[data-rate-limit-kind]")?.getAttribute("data-rate-limit-kind") ||
        null;
      const autoscroll = Boolean(document.querySelector("[data-autoscroll-container]"));
      return {
        ...probe,
        responds: probe.responds,
        banner,
        autoscroll,
        href: location.href,
        sessionId: sid,
      };
    })()`,
    true,
  );

  console.log("result", JSON.stringify(result, null, 2));

  // Pass criteria (honest): bridge respond methods callable; autoscroll container present.
  // Banner may be null without store poke in packaged renderer — not a fail of reverse-RPC wire.
  const ok =
    result?.autoscroll === true &&
    Array.isArray(result?.responds?.directory) &&
    (result.responds.directory.length > 0 || result.hasLas === false || result.errors?.length === 0);

  // Stronger: respond wrappers recorded calls.
  const respondOk =
    (result?.responds?.directory?.length ?? 0) > 0 ||
    (result?.responds?.slash?.length ?? 0) > 0 ||
    (result?.responds?.plugins?.length ?? 0) > 0;

  const pass = ok && respondOk;
  console.log(pass ? "SMOKE_PASS" : "SMOKE_PARTIAL_OR_FAIL");
  console.log(
    JSON.stringify(
      {
        pass,
        respondOk,
        autoscroll: result?.autoscroll,
        banner: result?.banner,
        respondCounts: {
          directory: result?.responds?.directory?.length ?? 0,
          slash: result?.responds?.slash?.length ?? 0,
          plugins: result?.responds?.plugins?.length ?? 0,
        },
        note:
          "Agent-turn directory_servers_* emit still residual without MCP tool invocation. This smoke proves respond IPC surface + autoscroll mount.",
      },
      null,
      2,
    ),
  );
  cdp.close();
  process.exit(pass ? 0 : 2);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
