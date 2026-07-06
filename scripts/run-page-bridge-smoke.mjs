#!/usr/bin/env node

const port = Number(process.env.CLAUDE_DESKTOP_CDP_PORT ?? process.argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length) ?? 9333);
const baseUrl = `http://127.0.0.1:${port}`;

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed: HTTP ${response.status}`);
  return response.json();
}

async function connectWebSocket(url) {
  if (typeof WebSocket !== "function") throw new Error("Node.js WebSocket global is unavailable");
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return ws;
}

function createCdpClient(ws) {
  let nextId = 1;
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.removeEventListener("message", onMessage);
          reject(new Error(`${method} timed out`));
        }, 50_000);
        function onMessage(event) {
          const message = JSON.parse(event.data);
          if (message.id !== id) return;
          clearTimeout(timeout);
          ws.removeEventListener("message", onMessage);
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result);
        }
        ws.addEventListener("message", onMessage);
      });
    },
    close() {
      ws.close();
    },
  };
}

const pageExpression = String.raw`
(async () => {
  const checks = [];
  const events = [];
  const scheduledEvents = [];
  const add = (name, ok, details = {}) => checks.push({ name, ok: Boolean(ok), details });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + " timed out after " + ms + "ms")), ms)),
  ]);
  const normalizeText = (value) => typeof value === "string" ? value : JSON.stringify(value ?? null);
  const web = window["claude.web"];
  const settings = window["claude.settings"];
  add("official namespaces exposed", !!web && !!settings, { webKeys: web ? Object.keys(web).length : 0, settingsKeys: settings ? Object.keys(settings).length : 0 });
  if (!web || !settings) return { ok: false, checks, error: "missing official namespaces" };

  for (const key of ["LocalSessions", "CCDScheduledTasks", "FileSystem"]) add("web." + key + " exposed", !!web[key]);
  for (const key of ["AppPreferences", "GlobalShortcut", "DesktopInfo", "FilePickers"]) add("settings." + key + " exposed", !!settings[key]);

  const fileSystem = web.FileSystem;
  const temp = await timeout(fileSystem.getSystemPath("temp"), 5_000, "getSystemPath(temp)");
  const sep = String(temp).includes("\\") ? "\\" : "/";
  const dir = String(temp).replace(/[\\/]$/, "") + sep + "claude-page-smoke-" + Date.now();
  const file = dir + sep + "sample.txt";
  const content = "page-smoke-" + Date.now();
  const written = await timeout(fileSystem.writeLocalFile(file, content, {}), 5_000, "writeLocalFile");
  const read = await timeout(fileSystem.readLocalFile(file, {}), 5_000, "readLocalFile");
  const entries = await timeout(fileSystem.listDirectory(dir), 5_000, "listDirectory");
  add("filesystem write/read roundtrip", normalizeText(read) === content, { file, written, read });
  add("filesystem listDirectory sees file", Array.isArray(entries) && entries.some((entry) => entry && entry.name === "sample.txt"), { count: Array.isArray(entries) ? entries.length : null });

  const sessions = web.LocalSessions;
  const offSession = sessions.onEvent?.((event) => events.push(event));
  const session = await timeout(sessions.start({ kind: "code", title: "Page smoke session", cwd: dir, folders: [dir], userSelectedFolders: [dir], permissionMode: "default" }), 8_000, "LocalSessions.start");
  const sessionId = session?.id || session?.sessionId;
  add("LocalSessions.start returns id", typeof sessionId === "string" && sessionId.length > 0, { sessionId, title: session?.title, cwd: session?.cwd });
  const allSessions = await timeout(sessions.getAll(), 5_000, "LocalSessions.getAll");
  add("LocalSessions.getAll includes new session", Array.isArray(allSessions) && allSessions.some((item) => (item?.id || item?.sessionId) === sessionId), { count: Array.isArray(allSessions) ? allSessions.length : null });
  const fetched = await timeout(sessions.getSession(sessionId), 5_000, "LocalSessions.getSession");
  add("LocalSessions.getSession returns created session", (fetched?.id || fetched?.sessionId) === sessionId, { fetchedId: fetched?.id || fetched?.sessionId });
  const sent = await timeout(sessions.sendMessage(sessionId, " "), 8_000, "LocalSessions.sendMessage whitespace");
  const transcript = await timeout(sessions.getTranscript(sessionId), 5_000, "LocalSessions.getTranscript");
  add("LocalSessions.sendMessage updates transcript without external CLI turn", Array.isArray(transcript) && transcript.length >= 1, { transcriptLength: Array.isArray(transcript) ? transcript.length : null, sentId: sent?.id || sent?.sessionId });
  const readAtCwd = await timeout(sessions.readFileAtCwd(sessionId, "sample.txt"), 5_000, "LocalSessions.readFileAtCwd");
  add("LocalSessions.readFileAtCwd reads workspace file", normalizeText(readAtCwd) === content, { readAtCwd });
  const gitDiff = await timeout(sessions.getGitDiff(sessionId), 8_000, "LocalSessions.getGitDiff");
  add("LocalSessions.getGitDiff returns command result", !!gitDiff && typeof gitDiff === "object" && "ok" in gitDiff, { ok: gitDiff?.ok, code: gitDiff?.code });
  const editors = await timeout(sessions.getInstalledEditors(), 8_000, "LocalSessions.getInstalledEditors");
  add("LocalSessions.getInstalledEditors returns editor status object", !!editors && typeof editors === "object" && ("vscode" in editors || Array.isArray(editors.editors)), editors);

  let ptyBuffer = "";
  let ptyStarted = false;
  try {
    ptyStarted = Boolean(await timeout(sessions.startShellPty(sessionId, 80, 24), 10_000, "LocalSessions.startShellPty"));
    if (ptyStarted) {
      await timeout(sessions.writeShellPty(sessionId, "echo page-smoke-pty" + String.fromCharCode(13)), 5_000, "LocalSessions.writeShellPty");
      await sleep(1_200);
      ptyBuffer = String(await timeout(sessions.getShellPtyBuffer(sessionId), 5_000, "LocalSessions.getShellPtyBuffer") ?? "");
      await timeout(sessions.stopShellPty(sessionId), 5_000, "LocalSessions.stopShellPty");
    }
    add("LocalSessions shell PTY echo roundtrip", ptyStarted && ptyBuffer.toLowerCase().includes("page-smoke-pty"), { ptyStarted, bufferTail: ptyBuffer.slice(-500) });
  } catch (error) {
    add("LocalSessions shell PTY echo roundtrip", false, { error: error instanceof Error ? error.message : String(error), ptyStarted, bufferTail: ptyBuffer.slice(-500) });
  }

  const tasks = web.CCDScheduledTasks;
  const offTask = tasks.onScheduledTaskEvent?.((event) => scheduledEvents.push(event));
  const taskId = "page-smoke-task-" + Date.now();
  const task = await timeout(tasks.createScheduledTask({ id: taskId, title: "Page smoke task", prompt: "", cwd: dir, enabled: true }), 5_000, "CCDScheduledTasks.createScheduledTask");
  add("CCDScheduledTasks.createScheduledTask returns task id", (task?.id || task?.name) === taskId, { taskId: task?.id || task?.name });
  const fileUpdated = await timeout(tasks.updateScheduledTaskFileContent(taskId, "task-file-" + content), 5_000, "CCDScheduledTasks.updateScheduledTaskFileContent");
  const taskFile = await timeout(tasks.getScheduledTaskFileContent(taskId), 5_000, "CCDScheduledTasks.getScheduledTaskFileContent");
  add("CCDScheduledTasks file content roundtrip", fileUpdated === true && taskFile === "task-file-" + content, { fileUpdated, taskFile });
  const disabled = await timeout(tasks.updateScheduledTaskStatus(taskId, "disabled"), 5_000, "CCDScheduledTasks.updateScheduledTaskStatus");
  const allTasks = await timeout(tasks.getAllScheduledTasks(), 5_000, "CCDScheduledTasks.getAllScheduledTasks");
  add("CCDScheduledTasks status/list roundtrip", disabled === true && Array.isArray(allTasks) && allTasks.some((item) => item?.id === taskId && item.enabled === false), { disabled, count: Array.isArray(allTasks) ? allTasks.length : null });

  const prefs = await timeout(settings.AppPreferences.getPreferences(), 5_000, "AppPreferences.getPreferences");
  const prefSet = await timeout(settings.AppPreferences.setPreference("pageSmokeLastRun", content), 5_000, "AppPreferences.setPreference");
  const prefsAfter = await timeout(settings.AppPreferences.getPreferences(), 5_000, "AppPreferences.getPreferences after set");
  add("settings AppPreferences get/set roundtrip", prefsAfter?.pageSmokeLastRun === content, { beforeType: typeof prefs, prefSet, after: prefsAfter?.pageSmokeLastRun });
  const shortcutBefore = await timeout(settings.GlobalShortcut.getGlobalShortcut(), 5_000, "GlobalShortcut.getGlobalShortcut");
  const shortcutUnset = await timeout(settings.GlobalShortcut.setGlobalShortcut(null), 5_000, "GlobalShortcut.setGlobalShortcut null");
  const shortcutAfter = await timeout(settings.GlobalShortcut.getGlobalShortcut(), 5_000, "GlobalShortcut.getGlobalShortcut after null");
  add("settings GlobalShortcut get/set null roundtrip", shortcutUnset === true && shortcutAfter === null, { shortcutBefore, shortcutUnset, shortcutAfter });
  const systemInfo = await timeout(settings.DesktopInfo.getSystemInfo(), 5_000, "DesktopInfo.getSystemInfo");
  add("settings DesktopInfo returns platform/userData", !!systemInfo?.platform && !!systemInfo?.userData, { platform: systemInfo?.platform, userData: systemInfo?.userData });
  add("settings FilePickers directory function available", typeof settings.FilePickers.getDirectoryPath === "function", { note: "not invoked to avoid blocking native dialog" });

  offSession?.();
  offTask?.();
  await timeout(tasks.updateScheduledTaskStatus(taskId, "deleted"), 5_000, "CCDScheduledTasks cleanup delete").catch(() => null);
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    url: location.href,
    title: document.title,
    tempDir: dir,
    eventCount: events.length,
    scheduledEventCount: scheduledEvents.length,
    checks,
    failed,
  };
})()
`;

const pages = await getJson("/json/list");
const target = pages.find((page) => page.url === "http://localhost:5176/" || page.url?.startsWith("http://localhost:5176/"));
if (!target) throw new Error(`React shell page not found. Pages: ${pages.map((page) => page.url).join(", ")}`);

const ws = await connectWebSocket(target.webSocketDebuggerUrl);
const cdp = createCdpClient(ws);
await cdp.send("Runtime.enable");
const result = await cdp.send("Runtime.evaluate", {
  expression: pageExpression,
  awaitPromise: true,
  returnByValue: true,
  timeout: 50_000,
});
cdp.close();

const value = result.result?.value ?? result.result;
console.log(JSON.stringify(value, null, 2));
if (!value?.ok) process.exit(1);
