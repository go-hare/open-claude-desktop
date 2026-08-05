/**
 * Hardware Buddy window UI — residual structure from
 *   app.asar .vite/renderer/buddy_window/assets/BuddyWindow-X4XRY9Jd.js (ce)
 *   assets/main-BQ4c6Ic9.css
 *
 * Bridge (buddy preload):
 *   globalThis["claude.buddy"].Buddy
 *     status / deviceStatus / install / preview / pairDevice / scanDevices /
 *     cancelScan / pickDevice / pickFolder / submitPin / forgetDevice / setName
 *     onPairingPrompt / onProgress
 *   window.buddy.getPathForFile
 *
 * data-official-source: BuddyWindow-X4XRY9Jd.js
 */
const buddyApi = globalThis["claude.buddy"]?.Buddy;
const inkDim = { color: "var(--ink-dim)" };
const titlePad = globalThis.process?.platform === "darwin" ? "pl-[83px]" : "pl-5";
const REPO_URL = "https://github.com/anthropics/claude-desktop-buddy";

const root = document.getElementById("root");

/** @type {any} */
let conn = null;
/** @type {any} */
let device = null;
let nameDraft = "";
/** @type {string | null} */
let folderPath = null;
/** @type {any} */
let preview = null;
let uploading = false;
let progress = { msg: "", pct: 0, cls: "" };
let pickOpen = false;
/** @type {Array<{id:string,name?:string}> | null} */
let scanned = null;
/** @type {string | null} */
let pairingName = null;
let guideOpen = false;
let dropOver = false;
let pollTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function btn(variant, size, label, opts = {}) {
  const node = el(
    "button",
    `buddy-btn buddy-btn-${variant} buddy-btn-${size} ${opts.className || ""}`.trim(),
    label,
  );
  node.type = "button";
  if (opts.disabled) node.disabled = true;
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.ariaLabel) node.setAttribute("aria-label", opts.ariaLabel);
  return node;
}

function formatUptime(seconds) {
  const a = Math.floor(seconds / 3600);
  const n = Math.floor((seconds % 3600) / 60);
  return a > 0 ? `${a}h${String(n).padStart(2, "0")}m` : `${n}m`;
}

function setProgress(msg, pct = progress.pct, cls = "") {
  progress = { msg, pct, cls };
  paint();
}

function statusLabel() {
  const connected = conn?.connected ?? false;
  if (connected) {
    if (device?.sec) return "Connected · Encrypted";
    return "Connected";
  }
  if (conn?.paired) return "Disconnected";
  return "No buddy paired";
}

async function refreshStatus() {
  if (!buddyApi?.status) return;
  try {
    const next = await buddyApi.status();
    conn = next ?? null;
    if (conn?.connected && buddyApi.deviceStatus) {
      device = (await buddyApi.deviceStatus()) ?? null;
      if (nameDraft === "" && device?.name) nameDraft = device.name;
    } else {
      device = null;
    }
  } catch (error) {
    console.error("buddy status", error);
  }
  paint();
}

async function loadPreview(path) {
  if (!path) return;
  try {
    const result = (await buddyApi?.preview?.(path)) ?? null;
    folderPath = result ? path : null;
    preview = result;
    if (!result) {
      setProgress("Can't read folder, or it's empty or too large", 0, "err");
    } else {
      progress = { msg: "", pct: 0, cls: "" };
      paint();
    }
  } catch (error) {
    setProgress(String(error?.message || error), 0, "err");
  }
}

function mountStick(parent) {
  const stick = el("div", "buddy-stick");
  const screen = el("div", "buddy-stick-screen");
  if (preview?.kind === "gif" && preview.dataUrl) {
    const img = document.createElement("img");
    img.src = preview.dataUrl;
    img.alt = "";
    screen.appendChild(img);
  } else if (preview?.frames?.length) {
    const frame = el("div", "font-mono text-[10px] whitespace-pre tracking-[0.02em]");
    frame.style.color = preview.color ?? "#fff";
    frame.textContent = preview.frames[0];
    screen.appendChild(frame);
  } else {
    const ph = el("div", "text-[11px] text-center px-4", "preview");
    ph.style.color = "#444";
    screen.appendChild(ph);
  }
  stick.appendChild(screen);
  const btnWrap = el("div", "flex-1 flex items-center justify-center");
  btnWrap.appendChild(el("div", "buddy-stick-btn"));
  stick.appendChild(btnWrap);
  parent.appendChild(stick);
}

function rowKV(parent, k, v, color) {
  const row = el("div", "flex justify-between py-[5px]");
  const left = el("span", null, k);
  Object.assign(left.style, inkDim);
  const right = el("span", "tabular-nums", v);
  if (color) right.style.color = color;
  row.appendChild(left);
  row.appendChild(right);
  parent.appendChild(row);
}

function sectionHeader(parent, text) {
  const node = el("div", "text-[10px] tracking-wider mt-2.5 mb-0.5", text);
  Object.assign(node.style, inkDim);
  parent.appendChild(node);
}

function mountStatusCard(parent) {
  const card = el("div", "buddy-card flex-1 min-w-0 p-4 text-xs overflow-y-auto");
  const connected = conn?.connected ?? false;

  const statusRow = el("div", "flex items-center gap-2 text-[13px]");
  statusRow.appendChild(el("span", `buddy-dot ${connected ? "on" : ""}`));
  statusRow.appendChild(el("span", null, statusLabel()));
  card.appendChild(statusRow);

  if (connected && device && !device.sec) {
    const warn = el("div", "text-[10px] mt-1 mb-2", "Connection is unencrypted");
    warn.style.color = "#e8a33d";
    warn.title =
      "This device requested an unencrypted connection. Data is being sent unencrypted, meaning that other devices close by can easily listen in.";
    card.appendChild(warn);
  }

  if (conn?.paired) {
    const paired = el("div", "py-1.5 pb-2.5 mb-3 border-b text-[11px]");
    paired.style.borderColor = "var(--line)";
    const name = el("div", "font-mono", conn.paired.name || "");
    name.style.color = "var(--ink)";
    paired.appendChild(name);
    const actions = el("div", "flex gap-1.5 mt-1");
    Object.assign(actions.style, inkDim);
    actions.appendChild(
      btn("ghost", "sm", "Change…", {
        onClick: () => {
          pickOpen = true;
          scanned = null;
          paint();
          void openScan();
        },
      }),
    );
    actions.appendChild(
      btn("ghost", "sm", "Forget", {
        onClick: () => {
          void buddyApi?.forgetDevice?.().then(refreshStatus);
        },
      }),
    );
    paired.appendChild(actions);
    card.appendChild(paired);
  }

  if (connected) {
    if (device) {
      const nameRow = el("div", "flex items-center justify-between gap-2 py-[5px]");
      const nameLabel = el("span", null, "Name");
      Object.assign(nameLabel.style, inkDim);
      const input = el("input", "w-14 min-w-0 px-2 py-1 border rounded text-[12px] tabular-nums text-right");
      input.style.borderColor = "var(--line)";
      input.style.background = "#fff";
      input.value = nameDraft;
      input.placeholder = device.name || "";
      input.maxLength = 22;
      input.addEventListener("input", () => {
        nameDraft = input.value;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void saveName();
      });
      const save = btn("ghost", "sm", "Save", {
        disabled: !nameDraft.trim() || nameDraft === device.name,
        onClick: () => void saveName(),
      });
      nameRow.appendChild(nameLabel);
      nameRow.appendChild(input);
      nameRow.appendChild(save);
      card.appendChild(nameRow);

      sectionHeader(card, "Battery");
      const batKey = device.bat?.usb
        ? device.bat.mA > 1
          ? "Charging"
          : "USB"
        : `${device.bat?.mA ?? 0}mA`;
      const batColor = (device.bat?.pct ?? 0) > 30 ? "var(--ok)" : "#e8a33d";
      rowKV(card, batKey, `${device.bat?.pct ?? 0}%`, batColor);

      sectionHeader(card, "Progress");
      rowKV(card, "Level", String(device.stats?.lvl ?? "—"));
      rowKV(card, "Approved", String(device.stats?.appr ?? "—"));
      rowKV(card, "Velocity", device.stats?.vel ? `${device.stats.vel}s` : "—");

      sectionHeader(card, "System");
      rowKV(card, "Uptime", formatUptime(device.sys?.up ?? 0));
      rowKV(card, "Heap", `${Math.round((device.sys?.heap ?? 0) / 1024)}KB`);
    } else {
      const nr = el("div", "text-xs", "No response");
      Object.assign(nr.style, inkDim);
      card.appendChild(nr);
    }
  } else {
    card.appendChild(
      btn("flat", "sm", "Connect", {
        className: "mt-3",
        onClick: () => void onConnect(),
      }),
    );
  }

  parent.appendChild(card);
}

async function saveName() {
  const value = nameDraft.trim();
  if (!value) return;
  try {
    const ok = await buddyApi?.setName?.(value);
    setProgress(ok ? "Name saved" : "Device did not respond", 0, ok ? "ok" : "err");
    await refreshStatus();
  } catch (error) {
    setProgress(String(error?.message || error), 0, "err");
  }
}

async function onConnect() {
  if (conn?.paired) {
    await buddyApi?.pairDevice?.();
    await refreshStatus();
    return;
  }
  pickOpen = true;
  scanned = null;
  paint();
  void openScan();
}

async function openScan() {
  try {
    scanned = (await buddyApi?.scanDevices?.()) ?? [];
  } catch {
    scanned = [];
  }
  paint();
}

function mountDropColumn(parent) {
  const col = el("div", "flex flex-col gap-4 flex-1 min-w-0");
  const drop = el(
    "div",
    `buddy-card buddy-dashed p-3.5 flex-1 flex flex-col items-center justify-center text-center cursor-pointer transition-colors hover-border-clay ${
      dropOver ? "buddy-drop-over" : ""
    }`,
  );
  drop.addEventListener("click", () => {
    void buddyApi?.pickFolder?.().then((path) => {
      if (path) void loadPreview(path);
    });
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!dropOver) {
      dropOver = true;
      paint();
    }
  });
  drop.addEventListener("dragleave", () => {
    if (dropOver) {
      dropOver = false;
      paint();
    }
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    dropOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file && globalThis.buddy?.getPathForFile) {
      void loadPreview(globalThis.buddy.getPathForFile(file));
    } else {
      paint();
    }
  });

  const hint = el("div", "text-[13px]");
  Object.assign(hint.style, inkDim);
  hint.appendChild(document.createTextNode("Drop a data folder here"));
  hint.appendChild(document.createElement("br"));
  hint.appendChild(document.createTextNode("or click to choose"));
  drop.appendChild(hint);
  if (folderPath) {
    const short = folderPath.split("/").slice(-2).join("/");
    const pathNode = el("div", "mt-2 font-mono text-[11px] break-all", short);
    Object.assign(pathNode.style, inkDim);
    drop.appendChild(pathNode);
  }
  col.appendChild(drop);
  col.appendChild(
    btn("flat", "lg", "Send to Device", {
      disabled: !folderPath || uploading,
      onClick: () => void sendFolder(),
    }),
  );
  parent.appendChild(col);
}

async function sendFolder() {
  if (!folderPath) return;
  uploading = true;
  progress = { msg: "Uploading…", pct: 0, cls: "" };
  paint();
  try {
    await buddyApi?.install?.(folderPath);
  } catch (error) {
    setProgress(String(error?.message || error), progress.pct, "err");
  } finally {
    uploading = false;
    paint();
  }
}

function mountGuideOverlay() {
  const overlay = el("div", "buddy-overlay nc-no-drag");
  const header = el("div", `h-[45px] flex items-center ${titlePad} pr-3 border-b shrink-0`);
  header.style.borderColor = "var(--line)";
  header.style.height = "45px";
  header.appendChild(el("h1", "text-xs font-bold opacity-40", "Hardware Buddy & Maker Devices"));
  header.appendChild(
    btn("ghost", "icon", "×", {
      className: "ml-auto text-lg leading-none",
      style: { color: "var(--ink)" },
      ariaLabel: "Close",
      onClick: () => {
        guideOpen = false;
        paint();
      },
    }),
  );
  overlay.appendChild(header);

  const body = el("div", "px-8 pt-5 pb-7 overflow-y-auto text-[13px] leading-relaxed select-text");
  const h2 = el("h2", "text-lg mb-1", "Connect maker devices to Claude");
  h2.style.color = "var(--ink)";
  body.appendChild(h2);

  const p = (text) => {
    const node = el("p", null, text);
    Object.assign(node.style, inkDim);
    body.appendChild(node);
    return node;
  };

  p(
    "Claude for macOS and Windows can connect Claude Cowork and Claude Code to maker devices over BLE, so developers can build hardware that displays permission prompts, recent messages, and other interactions.",
  );
  sectionHeader(body, "Reference implementation");
  const ref = el("p");
  Object.assign(ref.style, inkDim);
  ref.appendChild(
    document.createTextNode(
      "As an example, we built a desk pet that lives off permission approvals and interaction with Claude. Find the firmware, build instructions, and character pack guide in the ",
    ),
  );
  const a = el("a", null, "claude-desktop-buddy repository");
  a.href = REPO_URL;
  a.target = "_blank";
  a.rel = "noreferrer";
  ref.appendChild(a);
  ref.appendChild(document.createTextNode("."));
  body.appendChild(ref);

  sectionHeader(body, "Build your own device");
  p("The repository includes full details on building and connecting your own devices. Here's the short version.");
  const adv = el("p", "mt-3");
  Object.assign(adv.style, inkDim);
  adv.innerHTML =
    "Advertise a name starting with <code>Claude</code> over the Nordic UART Service. Everything on the wire is UTF-8 JSON—one object per line, terminated with <code>\\n</code>.";
  body.appendChild(adv);

  const pre1 = el("pre");
  pre1.textContent = [
    "service  6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    "rx write 6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    "tx notif 6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  ].join("\n");
  body.appendChild(pre1);

  p("The desktop apps send a heartbeat snapshot whenever something changes, plus a keepalive every 10 seconds:");
  const pre2 = el("pre");
  pre2.textContent = JSON.stringify(
    { total: 3, running: 1, waiting: 1, tokens_today: 31200, prompt: { id: "req_abc", tool: "Bash" } },
    null,
    2,
  );
  body.appendChild(pre2);

  const perm = el("p");
  Object.assign(perm.style, inkDim);
  perm.innerHTML = "When <code>prompt</code> is present, your device can return a response:";
  body.appendChild(perm);
  const pre3 = el("pre");
  pre3.textContent = [
    '{"cmd":"permission","id":"req_abc","decision":"once"}',
    '{"cmd":"permission","id":"req_abc","decision":"deny"}',
  ].join("\n");
  body.appendChild(pre3);

  p(
    "Each completed turn also fires a one-shot event containing the raw SDK content array—text blocks, tool calls, and any other content from the message. Events that serialize larger than 4KB are dropped.",
  );
  const pre4 = el("pre");
  pre4.textContent = '{"evt":"turn","role":"assistant","content":[...]}';
  body.appendChild(pre4);

  sectionHeader(body, "Availability");
  p(
    "The BLE API is only available when the desktop app is in developer mode. It's intended for makers and developers and isn't an officially supported product feature.",
  );

  overlay.appendChild(body);
  return overlay;
}

function mountPickerOverlay() {
  const overlay = el("div", "buddy-overlay nc-no-drag");
  overlay.appendChild(
    btn("ghost", "icon", "×", {
      className: "text-2xl leading-none",
      style: { position: "absolute", top: "50px", right: "16px", color: "var(--ink)" },
      onClick: () => {
        void buddyApi?.cancelScan?.();
        pickOpen = false;
        paint();
        void refreshStatus();
      },
    }),
  );
  const body = el("div", "px-8 pt-14 pb-7 overflow-y-auto text-[13px] leading-relaxed");
  const h2 = el("h2", "text-lg mb-1", "Choose your Buddy");
  h2.style.color = "var(--ink)";
  body.appendChild(h2);
  const sub = el("p");
  Object.assign(sub.style, inkDim);
  sub.textContent = scanned === null ? "Scanning for 5s…" : "Tap to pair:";
  body.appendChild(sub);

  const list = el("div", "flex flex-col gap-1.5 mt-3");
  if (scanned?.length === 0) {
    const empty = el("div", "text-xs py-3", "None found. Make sure yours is on and nearby.");
    Object.assign(empty.style, inkDim);
    list.appendChild(empty);
  }
  for (const deviceRow of scanned ?? []) {
    const item = el(
      "button",
      "buddy-card text-left font-mono text-[13px] p-3 hover-border-clay",
      deviceRow.name || deviceRow.id,
    );
    item.type = "button";
    item.style.width = "100%";
    item.addEventListener("click", () => {
      void buddyApi?.pickDevice?.(deviceRow.id).then(() => {
        pickOpen = false;
        void refreshStatus();
      });
    });
    list.appendChild(item);
  }
  body.appendChild(list);
  overlay.appendChild(body);
  return overlay;
}

function mountPairOverlay() {
  const overlay = el("div", "buddy-overlay nc-no-drag");
  const body = el("div", "px-8 pt-14 pb-7 text-[13px] leading-relaxed");
  const h2 = el("h2", "text-lg mb-1", `Pair with ${pairingName || "device"}`);
  h2.style.color = "var(--ink)";
  body.appendChild(h2);
  const p = el("p", null, "Enter the 6-digit code shown on the device's screen to connect.");
  Object.assign(p.style, inkDim);
  body.appendChild(p);

  const input = el(
    "input",
    "font-mono text-2xl tracking-[0.4em] text-center w-48 mt-4 px-3 py-2 border rounded",
  );
  input.inputMode = "numeric";
  input.maxLength = 6;
  input.setAttribute("aria-label", "Pairing code");
  input.style.borderColor = "var(--line)";
  input.style.background = "#fff";
  input.autofocus = true;

  const actions = el("div", "flex gap-2 mt-4");
  const pairBtn = btn("flat", "sm", "Pair", {
    disabled: true,
    onClick: () => submitPin(input.value),
  });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
    pairBtn.disabled = input.value.length !== 6;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && input.value.length === 6) submitPin(input.value);
  });
  actions.appendChild(pairBtn);
  actions.appendChild(
    btn("ghost", "sm", "Cancel", {
      onClick: () => submitPin(null),
    }),
  );
  body.appendChild(input);
  body.appendChild(actions);
  overlay.appendChild(body);
  setTimeout(() => input.focus(), 0);
  return overlay;
}

function submitPin(value) {
  void buddyApi?.submitPin?.(value);
  pairingName = null;
  paint();
  void refreshStatus();
}

function paint() {
  if (!root) return;
  const shell = el("div", "buddy-body h-screen flex flex-col font-sans text-sm select-none nc-drag");

  const header = el("header", `h-[45px] flex items-center ${titlePad} pr-3 border-b shrink-0`);
  header.style.height = "45px";
  header.style.borderColor = "var(--line)";
  header.appendChild(el("h1", "text-xs font-bold opacity-40", "Hardware Buddy & Maker Devices"));
  header.appendChild(
    btn("ghost", "sm", "What is this?", {
      className: "ml-auto nc-no-drag",
      style: inkDim,
      onClick: () => {
        guideOpen = true;
        paint();
      },
    }),
  );
  shell.appendChild(header);

  const main = el("main", "flex-1 px-6 pt-5 pb-5 flex flex-col gap-4 nc-no-drag min-h-0 overflow-hidden");
  const row = el("div", "flex gap-5 items-stretch flex-1 min-h-0");
  mountStick(row);
  mountStatusCard(row);
  mountDropColumn(row);
  main.appendChild(row);

  const footer = el("div");
  const bar = el("div", `buddy-bar ${uploading || progress.pct ? "active" : ""}`);
  const barInner = el("div");
  barInner.style.width = `${progress.pct || 0}%`;
  bar.appendChild(barInner);
  footer.appendChild(bar);
  const msg = el(
    "div",
    `mt-2 font-mono text-[11px] min-h-[14px] ${
      progress.cls === "err" ? "whitespace-pre-wrap text-left" : "text-center"
    }`,
    progress.msg || "",
  );
  msg.style.color =
    progress.cls === "ok" ? "var(--ok)" : progress.cls === "err" ? "var(--err)" : "var(--ink-dim)";
  footer.appendChild(msg);
  main.appendChild(footer);
  shell.appendChild(main);

  if (guideOpen) shell.appendChild(mountGuideOverlay());
  if (pairingName) shell.appendChild(mountPairOverlay());
  if (pickOpen) shell.appendChild(mountPickerOverlay());

  root.replaceChildren(shell);
}

function bindEvents() {
  const onPairing = buddyApi?.onPairingPrompt ?? buddyApi?.pairingPrompt;
  if (typeof onPairing === "function") {
    onPairing((deviceName) => {
      pickOpen = false;
      pairingName = typeof deviceName === "string" ? deviceName : String(deviceName ?? "");
      paint();
    });
  }
  const onProgress = buddyApi?.onProgress ?? buddyApi?.progress;
  if (typeof onProgress === "function") {
    onProgress((msg) => {
      const text = String(msg ?? "");
      const match = text.match(/(\d+)%/);
      progress = {
        msg: text,
        pct: text.startsWith("✓") ? 100 : match ? Number(match[1]) : 0,
        cls: text.startsWith("✓") ? "ok" : text.startsWith("✗") ? "err" : "",
      };
      paint();
    });
  }
}

function start() {
  bindEvents();
  paint();
  void refreshStatus();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    void refreshStatus();
  }, 2000);
}

if (document.readyState === "loading") {
  window.addEventListener("load", start);
} else {
  start();
}
