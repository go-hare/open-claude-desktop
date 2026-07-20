import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const base = "http://127.0.0.1:9223";
const targetSid = "local_724bccd9-7917-44fc-b49c-6d345996d494";
const watchDir = "/Users/apple/work-py/AppAgent";
const probeName = `fs_watch_probe_${Date.now()}.txt`;
const probePath = join(watchDir, probeName);

async function getPage(urlSubstr = "5176") {
  const list = await (await fetch(`${base}/json/list`)).json();
  const page = list.find(
    (t) => t.type === "page" && String(t.url || "").includes(urlSubstr),
  );
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
  return { ws, ready, send, evaluate, close: () => ws.close() };
}

async function main() {
  const page = await getPage("5176");
  const cdp = createSession(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  const href = await cdp.evaluate("location.href");
  if (!String(href).includes(targetSid)) {
    await cdp.send("Page.navigate", {
      url: `http://localhost:5176/local_sessions/${targetSid}`,
    });
    await new Promise((r) => setTimeout(r, 2500));
  }

  const prep = await cdp.evaluate(
    `(async () => {
      const las = window["claude.web"]?.LocalAgentModeSessions;
      if (!las) return { err: "no LAS" };
      window.__fsProbe = [];
      if (window.__fsProbeOff) {
        try { window.__fsProbeOff(); } catch {}
      }
      const hasOnEvent = typeof las.onEvent === "function";
      if (hasOnEvent) {
        window.__fsProbeOff = las.onEvent((e) => {
          window.__fsProbe.push({
            type: e?.type,
            sessionId: e?.sessionId,
            fileName: e?.fsFile?.fileName || e?.fileName || null,
            hostPath: e?.fsFile?.hostPath || null,
            t: Date.now(),
          });
        });
      }
      const add = typeof las.addFolderToSession === "function"
        ? await las.addFolderToSession(${JSON.stringify(targetSid)}, ${JSON.stringify(watchDir)})
        : { err: "no addFolder" };
      const session = await las.getSession(${JSON.stringify(targetSid)});
      return {
        hasOnEvent,
        add,
        folders: session?.userSelectedFolders || session?.folders || null,
        fsN: Array.isArray(session?.fsDetectedFiles) ? session.fsDetectedFiles.length : 0,
        href: location.href,
        lasKeys: Object.keys(las).filter((k) => /event|Event|subscribe|on/.test(k)),
      };
    })()`,
    true,
  );
  console.log("prep", JSON.stringify(prep, null, 2));

  await new Promise((r) => setTimeout(r, 400));

  writeFileSync(probePath, `probe ${new Date().toISOString()}\\n`, "utf8");
  console.log("wrote", probePath);

  let result = null;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    result = await cdp.evaluate(
      `(async () => {
        const las = window["claude.web"]?.LocalAgentModeSessions;
        const session = las ? await las.getSession(${JSON.stringify(targetSid)}) : null;
        const fs = Array.isArray(session?.fsDetectedFiles) ? session.fsDetectedFiles : [];
        const events = window.__fsProbe || [];
        const hitEvent = events.filter((e) =>
          String(e.fileName || "").includes(${JSON.stringify(probeName)}) ||
          String(e.hostPath || "").includes(${JSON.stringify(probeName)})
        );
        const hitFs = fs.filter((f) =>
          String(f.fileName || "").includes(${JSON.stringify(probeName)}) ||
          String(f.hostPath || "").includes(${JSON.stringify(probeName)})
        );
        const bodyText = document.body?.innerText || "";
        const activityHit = bodyText.includes(${JSON.stringify(probeName)});
        return {
          eventN: events.length,
          events: events.slice(-12),
          hitEvent,
          hitFs,
          fsN: fs.length,
          fsNames: fs.slice(0, 10).map((f) => f.fileName || f.hostPath),
          activityHit,
        };
      })()`,
      true,
    );
    if ((result.hitEvent && result.hitEvent.length) || (result.hitFs && result.hitFs.length)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("result", JSON.stringify(result, null, 2));

  try {
    if (existsSync(probePath)) unlinkSync(probePath);
  } catch {}

  await new Promise((r) => setTimeout(r, 500));
  const afterDelete = await cdp.evaluate(
    `(() => {
      const events = window.__fsProbe || [];
      return {
        last: events.slice(-8),
        deleted: events.filter((e) => e.type === "fs_file_deleted"),
      };
    })()`,
  );
  console.log("afterDelete", JSON.stringify(afterDelete, null, 2));

  const ok =
    (result?.hitEvent && result.hitEvent.length > 0) ||
    (result?.hitFs && result.hitFs.length > 0);
  console.log(ok ? "SMOKE_PASS" : "SMOKE_FAIL");
  cdp.close();
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
