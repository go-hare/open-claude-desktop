import { randomUUID } from "node:crypto";
function detectMimeFromBase64(b64) {
  const raw = Buffer.from(b64.slice(0, 16), "base64");
  if (raw[0] === 137 && raw[1] === 80 && raw[2] === 78 && raw[3] === 71)
    return "image/png";
  if (raw[0] === 255 && raw[1] === 216 && raw[2] === 255) return "image/jpeg";
  if (raw[0] === 82 && raw[1] === 73 && raw[2] === 70 && raw[3] === 70 && // RIFF
  raw[8] === 87 && raw[9] === 69 && raw[10] === 66 && raw[11] === 80)
    return "image/webp";
  if (raw[0] === 71 && raw[1] === 73 && raw[2] === 70) return "image/gif";
  return "image/png";
}
import {
  getDefaultTierForApp,
  getDeniedCategoryForApp,
  isPolicyDenied
} from "./deniedApps.js";
import { isSystemKeyCombo } from "./keyBlocklist.js";
import { validateClickTarget } from "./pixelCompare.js";
import { SENTINEL_BUNDLE_IDS } from "./sentinelApps.js";
import { toLoggerDetail } from "./types.js";
const FINDER_BUNDLE_ID = "com.apple.finder";
function errorResult(text, errorKind) {
  return {
    content: [{ type: "text", text }],
    isError: true,
    telemetry: errorKind ? { error_kind: errorKind } : void 0
  };
}
function okText(text) {
  return { content: [{ type: "text", text }] };
}
function okJson(obj, telemetry) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj) }],
    telemetry
  };
}
function asRecord(args) {
  if (typeof args === "object" && args !== null) {
    return args;
  }
  return {};
}
function requireNumber(args, key) {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return new Error(`"${key}" must be a finite number.`);
  }
  return v;
}
function requireString(args, key) {
  const v = args[key];
  if (typeof v !== "string") {
    return new Error(`"${key}" must be a string.`);
  }
  return v;
}
function extractCoordinate(args, paramName = "coordinate") {
  const coord = args[paramName];
  if (coord === void 0) {
    return new Error(`${paramName} is required`);
  }
  if (!Array.isArray(coord) || coord.length !== 2) {
    return new Error(`${paramName} must be an array of length 2`);
  }
  const [x, y] = coord;
  if (typeof x !== "number" || typeof y !== "number" || x < 0 || y < 0) {
    return new Error(`${paramName} must be a tuple of non-negative numbers`);
  }
  return [x, y];
}
function scaleCoord(rawX, rawY, mode, display, lastScreenshot, logger) {
  if (mode === "normalized_0_100") {
    return {
      x: Math.round(rawX / 100 * display.width) + display.originX,
      y: Math.round(rawY / 100 * display.height) + display.originY
    };
  }
  if (lastScreenshot) {
    return {
      x: Math.round(
        rawX * (lastScreenshot.displayWidth / lastScreenshot.width)
      ) + lastScreenshot.originX,
      y: Math.round(
        rawY * (lastScreenshot.displayHeight / lastScreenshot.height)
      ) + lastScreenshot.originY
    };
  }
  logger.warn(
    "[computer-use] pixels-mode coordinate received with no prior screenshot; falling back to /scaleFactor. Click may be off if downsample is active."
  );
  return {
    x: Math.round(rawX / display.scaleFactor) + display.originX,
    y: Math.round(rawY / display.scaleFactor) + display.originY
  };
}
function coordToPercentageForPixelCompare(rawX, rawY, mode, lastScreenshot) {
  if (mode === "normalized_0_100") {
    return { xPct: rawX, yPct: rawY };
  }
  if (!lastScreenshot) {
    return { xPct: 0, yPct: 0 };
  }
  return {
    xPct: rawX / lastScreenshot.width * 100,
    yPct: rawY / lastScreenshot.height * 100
  };
}
function tierSatisfies(grantTier, actionKind) {
  const tier = grantTier ?? "full";
  if (actionKind === "mouse_position") return true;
  if (actionKind === "keyboard" || actionKind === "mouse_full") {
    return tier === "full";
  }
  return tier === "click" || tier === "full";
}
const TIER_ANTI_SUBVERSION = " Do not attempt to work around this restriction \u2014 never use AppleScript, System Events, shell commands, or any other method to send clicks or keystrokes to this app.";
async function syncClipboardStash(adapter, overrides, frontmostIsClickTier) {
  const current = overrides.getClipboardStash?.();
  if (!frontmostIsClickTier) {
    if (current === void 0) return;
    try {
      await adapter.executor.writeClipboard(current);
      overrides.onClipboardStashChanged?.(void 0);
    } catch {
    }
    return;
  }
  if (current === void 0) {
    try {
      const read = await adapter.executor.readClipboard();
      overrides.onClipboardStashChanged?.(read);
    } catch {
      overrides.onClipboardStashChanged?.("");
    }
  }
  try {
    await adapter.executor.writeClipboard("");
  } catch {
  }
}
async function runInputActionGates(adapter, overrides, subGates, actionKind) {
  if (subGates.hideBeforeAction) {
    const hidden = await adapter.executor.prepareForAction(
      overrides.allowedApps.map((a) => a.bundleId),
      overrides.selectedDisplayId
    );
    if (hidden.length > 0) {
      overrides.onAppsHidden?.(hidden);
    }
  }
  if (adapter.executor.capabilities.screenshotFiltering === "none") {
    return null;
  }
  const frontmost = await adapter.executor.getFrontmostApp();
  const tierByBundleId = new Map(
    overrides.allowedApps.map((a) => [a.bundleId, a.tier])
  );
  const frontmostTier = frontmost ? tierByBundleId.get(frontmost.bundleId) : void 0;
  if (subGates.clipboardGuard) {
    await syncClipboardStash(adapter, overrides, frontmostTier === "click");
  }
  if (!frontmost) {
    return null;
  }
  const { hostBundleId } = adapter.executor.capabilities;
  if (frontmostTier !== void 0) {
    if (tierSatisfies(frontmostTier, actionKind)) return null;
    if (frontmostTier === "read") {
      const isBrowser = getDeniedCategoryForApp(frontmost.bundleId, frontmost.displayName) === "browser";
      return errorResult(
        `"${frontmost.displayName}" is granted at tier "read" \u2014 visible in screenshots only, no clicks or typing.` + (isBrowser ? " Use the Claude-in-Chrome MCP for browser interaction (tools named `mcp__Claude_in_Chrome__*`; load via SearchExtraTools if deferred)." : " No interaction is permitted; ask the user to take any actions in this app themselves.") + TIER_ANTI_SUBVERSION,
        "tier_insufficient"
      );
    }
    if (actionKind === "keyboard") {
      return errorResult(
        `"${frontmost.displayName}" is granted at tier "click" \u2014 typing, key presses, and paste require tier "full". The keys would go to this app's text fields or integrated terminal. To type into a different app, click it first to bring it forward. For shell commands, use the Bash tool.` + TIER_ANTI_SUBVERSION,
        "tier_insufficient"
      );
    }
    return errorResult(
      `"${frontmost.displayName}" is granted at tier "click" \u2014 right-click, middle-click, and clicks with modifier keys require tier "full". Right-click opens a context menu with Paste/Cut, and modifier chords fire as keystrokes before the click. Plain left_click is allowed here.` + TIER_ANTI_SUBVERSION,
      "tier_insufficient"
    );
  }
  if (frontmost.bundleId === FINDER_BUNDLE_ID) return null;
  if (frontmost.bundleId === hostBundleId) {
    if (actionKind !== "keyboard") {
      return null;
    }
    return errorResult(
      "Claude's own window still has keyboard focus. This should not happen after the pre-action defocus. Click on the target application first.",
      "state_conflict"
    );
  }
  return errorResult(
    `"${frontmost.displayName}" is not in the allowed applications and is currently in front. Take a new screenshot \u2014 it may have appeared since your last one.`,
    "app_not_granted"
  );
}
async function runHitTestGate(adapter, overrides, subGates, x, y, actionKind) {
  if (adapter.executor.capabilities.screenshotFiltering === "none") {
    return null;
  }
  const target = await adapter.executor.appUnderPoint(x, y);
  if (!target) return null;
  if (target.bundleId === FINDER_BUNDLE_ID) return null;
  const tierByBundleId = new Map(
    overrides.allowedApps.map((a) => [a.bundleId, a.tier])
  );
  if (!tierByBundleId.has(target.bundleId)) {
    return errorResult(
      `Click at these coordinates would land on "${target.displayName}", which is not in the allowed applications. Take a fresh screenshot to see the current window layout.`,
      "app_not_granted"
    );
  }
  const targetTier = tierByBundleId.get(target.bundleId);
  if (subGates.clipboardGuard && targetTier === "click") {
    await syncClipboardStash(adapter, overrides, true);
  }
  if (tierSatisfies(targetTier, actionKind)) return null;
  if (actionKind === "mouse_full" && targetTier === "click") {
    return errorResult(
      `Click at these coordinates would land on "${target.displayName}", which is granted at tier "click" \u2014 right-click, middle-click, and clicks with modifier keys require tier "full" (they can Paste via the context menu or fire modifier-chord keystrokes). Plain left_click is allowed here.` + TIER_ANTI_SUBVERSION,
      "tier_insufficient"
    );
  }
  const isBrowser = getDeniedCategoryForApp(target.bundleId, target.displayName) === "browser";
  return errorResult(
    `Click at these coordinates would land on "${target.displayName}", which is granted at tier "read" (screenshots only, no interaction). ` + (isBrowser ? "Use the Claude-in-Chrome MCP for browser interaction." : "Ask the user to take any actions in this app themselves.") + TIER_ANTI_SUBVERSION,
    "tier_insufficient"
  );
}
const MIN_SCREENSHOT_BYTES = 1024;
function decodedByteLength(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length * 3 / 4) - padding;
}
async function takeScreenshotWithRetry(executor, allowedBundleIds, logger, displayId) {
  let shot = await executor.screenshot({ allowedBundleIds, displayId });
  if (decodedByteLength(shot.base64) < MIN_SCREENSHOT_BYTES) {
    logger.warn(
      `[computer-use] screenshot implausibly small (${decodedByteLength(shot.base64)} bytes decoded), retrying once`
    );
    shot = await executor.screenshot({ allowedBundleIds, displayId });
  }
  return shot;
}
const INTER_GRAPHEME_SLEEP_MS = 8;
function segmentGraphemes(text) {
  try {
    const Segmenter = Intl.Segmenter;
    if (typeof Segmenter === "function") {
      const seg = new Segmenter(void 0, { granularity: "grapheme" });
      return Array.from(seg.segment(text), (s) => s.segment);
    }
  } catch {
  }
  return Array.from(text);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function parseKeyChord(text) {
  return text.split("+").map((s) => s.trim()).filter(Boolean);
}
let mouseButtonHeld = false;
let mouseMoved = false;
function resetMouseButtonHeld() {
  mouseButtonHeld = false;
  mouseMoved = false;
}
async function releaseHeldMouse(adapter) {
  if (!mouseButtonHeld) return;
  await adapter.executor.mouseUp();
  mouseButtonHeld = false;
  mouseMoved = false;
}
function defersLockAcquire(toolName) {
  return toolName === "request_access" || toolName === "list_granted_applications";
}
const REVERSE_DNS_RE = /^[A-Za-z0-9][\w.-]*\.[A-Za-z0-9][\w.-]*$/;
function looksLikeBundleId(s) {
  return REVERSE_DNS_RE.test(s) && !s.includes(" ");
}
function resolveRequestedApps(requestedNames, installed, alreadyGrantedBundleIds) {
  const byLowerDisplayName = /* @__PURE__ */ new Map();
  const byBundleId = /* @__PURE__ */ new Map();
  for (const app of installed) {
    byBundleId.set(app.bundleId, app);
    byLowerDisplayName.set(app.displayName.toLowerCase(), app);
  }
  return requestedNames.map((requested) => {
    let resolved;
    if (looksLikeBundleId(requested)) {
      resolved = byBundleId.get(requested);
    }
    if (!resolved) {
      resolved = byLowerDisplayName.get(requested.toLowerCase());
    }
    if (!resolved) {
      const clean = requested.toLowerCase().replace(/\.exe$/, "").trim();
      for (const [name, app] of byLowerDisplayName) {
        if (name.includes(clean) || clean.includes(name)) {
          resolved = app;
          break;
        }
      }
    }
    const bundleId = resolved?.bundleId;
    const bundleIdCandidate = bundleId ?? (looksLikeBundleId(requested) ? requested : void 0);
    return {
      requestedName: requested,
      resolved,
      isSentinel: bundleId ? SENTINEL_BUNDLE_IDS.has(bundleId) : false,
      alreadyGranted: bundleId ? alreadyGrantedBundleIds.has(bundleId) : false,
      proposedTier: getDefaultTierForApp(
        bundleIdCandidate,
        resolved?.displayName ?? requested
      )
    };
  });
}
async function handleRequestAccess(adapter, args, overrides, tccState) {
  if (!overrides.onPermissionRequest) {
    return errorResult(
      "This session was not wired with a permission handler. Computer control is not available here.",
      "feature_unavailable"
    );
  }
  if (overrides.getTeachModeActive?.()) {
    return errorResult(
      "Cannot request additional permissions during teach mode \u2014 the permission dialog would be hidden. End teach mode (finish the tour or let the turn complete), then call request_access, then start a new tour.",
      "teach_mode_conflict"
    );
  }
  const reason = requireString(args, "reason");
  if (reason instanceof Error) return errorResult(reason.message, "bad_args");
  if (tccState) {
    const req = {
      requestId: randomUUID(),
      reason,
      apps: [],
      requestedFlags: {},
      screenshotFiltering: adapter.executor.capabilities.screenshotFiltering,
      tccState
    };
    await overrides.onPermissionRequest(req);
    const recheck = await adapter.ensureOsPermissions();
    if (recheck.granted) {
      return errorResult(
        "macOS Accessibility and Screen Recording are now both granted. Call request_access again immediately \u2014 the next call will show the app selection list."
      );
    }
    const perms = recheck;
    const missing = [];
    if (!perms.accessibility) missing.push("Accessibility");
    if (!perms.screenRecording) missing.push("Screen Recording");
    return errorResult(
      `macOS ${missing.join(" and ")} permission(s) not yet granted. The permission panel has been shown. Once the user grants the missing permission(s), call request_access again.`,
      "tcc_not_granted"
    );
  }
  const rawApps = args.apps;
  if (!Array.isArray(rawApps) || !rawApps.every((a) => typeof a === "string")) {
    return errorResult('"apps" must be an array of strings.', "bad_args");
  }
  const apps = rawApps;
  const requestedFlags = {};
  if (typeof args.clipboardRead === "boolean") {
    requestedFlags.clipboardRead = args.clipboardRead;
  }
  if (typeof args.clipboardWrite === "boolean") {
    requestedFlags.clipboardWrite = args.clipboardWrite;
  }
  if (typeof args.systemKeyCombos === "boolean") {
    requestedFlags.systemKeyCombos = args.systemKeyCombos;
  }
  const {
    needDialog,
    skipDialogGrants,
    willHide,
    tieredApps,
    userDenied,
    policyDenied
  } = await buildAccessRequest(
    adapter,
    apps,
    overrides.allowedApps,
    new Set(overrides.userDeniedBundleIds),
    overrides.selectedDisplayId
  );
  let dialogGranted = [];
  let dialogDenied = [];
  let dialogFlags = overrides.grantFlags;
  if (needDialog.length > 0 || Object.keys(requestedFlags).length > 0) {
    const req = {
      requestId: randomUUID(),
      reason,
      apps: needDialog,
      requestedFlags,
      screenshotFiltering: adapter.executor.capabilities.screenshotFiltering,
      // Undefined when empty so the renderer skips the section cleanly.
      ...willHide.length > 0 && {
        willHide,
        autoUnhideEnabled: adapter.getAutoUnhideEnabled()
      }
    };
    const response = await overrides.onPermissionRequest(req);
    dialogGranted = response.granted;
    dialogDenied = response.denied;
    dialogFlags = response.flags;
  }
  const allGranted = [...skipDialogGrants, ...dialogGranted];
  const grantedBundleIds = new Set(allGranted.map((g) => g.bundleId));
  const grantedTieredApps = tieredApps.filter(
    (t) => grantedBundleIds.has(t.bundleId)
  );
  let windowLocations = [];
  try {
    windowLocations = await buildWindowLocations(adapter, allGranted);
  } catch (e) {
    adapter.logger.warn(
      `[computer-use] buildWindowLocations failed: ${String(e)}`
    );
  }
  return okJson(
    {
      granted: allGranted,
      denied: dialogDenied,
      // Policy blocklist — precedes userDenied in precedence and response
      // order. No escape hatch; the agent is told to find another approach.
      ...policyDenied.length > 0 && {
        policyDenied: {
          apps: policyDenied,
          guidance: buildPolicyDeniedGuidance(policyDenied)
        }
      },
      // User-configured auto-deny — stripped before the dialog; this is the
      // agent's only signal that these apps exist but are user-blocked.
      ...userDenied.length > 0 && {
        userDenied: {
          apps: userDenied,
          guidance: buildUserDeniedGuidance(userDenied)
        }
      },
      // Upfront guidance so the model knows what each tier allows BEFORE
      // hitting the gate. Only included when something was tier-restricted.
      ...grantedTieredApps.length > 0 && {
        tierGuidance: buildTierGuidanceMessage(grantedTieredApps)
      },
      screenshotFiltering: adapter.executor.capabilities.screenshotFiltering,
      // Where each granted app currently has open windows, across monitors.
      // Omitted when the app isn't running or has no normal windows.
      ...windowLocations.length > 0 ? { windowLocations } : {}
    },
    {
      // dialogGranted only — skipDialogGrants are idempotent re-grants of
      // apps already in the allowlist (no user action, dialog skips them).
      // Matching denied_count's this-call-only semantics.
      granted_count: dialogGranted.length,
      denied_count: dialogDenied.length,
      ...tierAssignmentTelemetry(grantedTieredApps)
    }
  );
}
async function buildWindowLocations(adapter, granted) {
  if (granted.length === 0) return [];
  const displays = await adapter.executor.listDisplays();
  if (displays.length <= 1) return [];
  const grantedBundleIds = granted.map((g) => g.bundleId);
  const windowLocs = await adapter.executor.findWindowDisplays(grantedBundleIds);
  const displayById = new Map(displays.map((d) => [d.displayId, d]));
  const idsByBundle = new Map(windowLocs.map((w) => [w.bundleId, w.displayIds]));
  const out = [];
  for (const g of granted) {
    const displayIds = idsByBundle.get(g.bundleId);
    if (!displayIds || displayIds.length === 0) continue;
    out.push({
      bundleId: g.bundleId,
      displayName: g.displayName,
      displays: displayIds.map((id) => {
        const d = displayById.get(id);
        return { id, label: d?.label, isPrimary: d?.isPrimary };
      })
    });
  }
  return out;
}
async function buildAccessRequest(adapter, apps, allowedApps, userDeniedBundleIds, selectedDisplayId) {
  const alreadyGranted = new Set(allowedApps.map((g) => g.bundleId));
  const installed = await adapter.executor.listInstalledApps();
  const resolved = resolveRequestedApps(apps, installed, alreadyGranted);
  const policyDenied = [];
  const afterPolicy = [];
  for (const r of resolved) {
    const displayName = r.resolved?.displayName ?? r.requestedName;
    if (isPolicyDenied(r.resolved?.bundleId, displayName)) {
      policyDenied.push({ requestedName: r.requestedName, displayName });
    } else {
      afterPolicy.push(r);
    }
  }
  const userDenied = [];
  const surviving = [];
  for (const r of afterPolicy) {
    if (r.resolved && userDeniedBundleIds.has(r.resolved.bundleId)) {
      userDenied.push({
        requestedName: r.requestedName,
        displayName: r.resolved.displayName
      });
    } else {
      surviving.push(r);
    }
  }
  const tieredApps = [];
  for (const r of surviving) {
    if (r.proposedTier === "full" || !r.resolved) continue;
    tieredApps.push({
      bundleId: r.resolved.bundleId,
      displayName: r.resolved.displayName,
      tier: r.proposedTier
    });
  }
  const skipDialog = surviving.filter((r) => r.alreadyGranted);
  const needDialog = surviving.filter((r) => !r.alreadyGranted);
  for (const r of needDialog) {
    if (!r.resolved) continue;
    try {
      r.resolved.iconDataUrl = await adapter.executor.getAppIcon(
        r.resolved.path
      );
    } catch {
    }
  }
  const now = Date.now();
  const skipDialogGrants = skipDialog.filter((r) => r.resolved).map((r) => {
    const existing = allowedApps.find(
      (g) => g.bundleId === r.resolved.bundleId
    );
    return existing ?? {
      bundleId: r.resolved.bundleId,
      displayName: r.resolved.displayName,
      grantedAt: now,
      tier: r.proposedTier
    };
  });
  const exemptForPreview = [
    ...allowedApps.map((a) => a.bundleId),
    ...surviving.filter((r) => r.resolved).map((r) => r.resolved.bundleId)
  ];
  const willHide = await adapter.executor.previewHideSet(
    exemptForPreview,
    selectedDisplayId
  );
  return {
    needDialog,
    skipDialogGrants,
    willHide,
    tieredApps,
    userDenied,
    policyDenied
  };
}
function buildTierGuidanceMessage(tiered) {
  const readBrowsers = tiered.filter(
    (t) => t.tier === "read" && getDeniedCategoryForApp(t.bundleId, t.displayName) === "browser"
  );
  const readOther = tiered.filter(
    (t) => t.tier === "read" && getDeniedCategoryForApp(t.bundleId, t.displayName) !== "browser"
  );
  const clickTier = tiered.filter((t) => t.tier === "click");
  const parts = [];
  if (readBrowsers.length > 0) {
    const names = readBrowsers.map((b) => `"${b.displayName}"`).join(", ");
    parts.push(
      `${names} ${readBrowsers.length === 1 ? "is a browser" : "are browsers"} \u2014 granted at tier "read" (visible in screenshots only; no clicks or typing). You can read what's on screen but cannot navigate, click, or type into ${readBrowsers.length === 1 ? "it" : "them"}. For browser interaction, use the Claude-in-Chrome MCP (tools named \`mcp__Claude_in_Chrome__*\`; load via SearchExtraTools if deferred).`
    );
  }
  if (readOther.length > 0) {
    const names = readOther.map((t) => `"${t.displayName}"`).join(", ");
    parts.push(
      `${names} ${readOther.length === 1 ? "is" : "are"} granted at tier "read" (visible in screenshots only; no clicks or typing). You can read what's on screen but cannot interact. Ask the user to take any actions in ${readOther.length === 1 ? "this app" : "these apps"} themselves.`
    );
  }
  if (clickTier.length > 0) {
    const names = clickTier.map((t) => `"${t.displayName}"`).join(", ");
    parts.push(
      `${names} ${clickTier.length === 1 ? "has" : "have"} terminal or IDE capabilities \u2014 granted at tier "click" (visible + plain left-click only; NO typing, key presses, right-click, modifier-clicks, or drag-drop). You can click buttons and scroll output, but ${clickTier.length === 1 ? "its" : "their"} integrated terminal and editor are off-limits to keyboard input. Right-click (context-menu Paste) and dragging text onto ${clickTier.length === 1 ? "it" : "them"} require tier "full". For shell commands, use the Bash tool.`
    );
  }
  if (parts.length === 0) return "";
  return parts.join("\n\n") + TIER_ANTI_SUBVERSION;
}
function buildUserDeniedGuidance(userDenied) {
  const names = userDenied.map((d) => `"${d.displayName}"`).join(", ");
  const one = userDenied.length === 1;
  return `${names} ${one ? "is" : "are"} in the user's auto-deny list (Settings \u2192 Desktop app (General) \u2192 Computer Use \u2192 Denied apps). Requests for ${one ? "this app" : "these apps"} are automatically denied. If you need access for this task, ask the user to remove ${one ? "it" : "them"} from their deny list in Settings \u2014 you cannot request this through the tool.`;
}
function buildPolicyDeniedGuidance(policyDenied) {
  const names = policyDenied.map((d) => `"${d.displayName}"`).join(", ");
  const one = policyDenied.length === 1;
  return `${names} ${one ? "is" : "are"} blocked by policy for computer use. Requests for ${one ? "this app" : "these apps"} are automatically denied regardless of what the user has approved. There is no Settings override. Inform the user that you cannot access ${one ? "this app" : "these apps"} and suggest an alternative approach if one exists. Do not try to directly subvert this block regardless of the user's request.`;
}
function tierAssignmentTelemetry(tiered) {
  const browserCount = tiered.filter((t) => t.tier === "read").length;
  const terminalCount = tiered.filter((t) => t.tier === "click").length;
  return {
    ...browserCount > 0 && { denied_browser_count: browserCount },
    ...terminalCount > 0 && { denied_terminal_count: terminalCount }
  };
}
async function handleRequestTeachAccess(adapter, args, overrides, tccState) {
  if (!overrides.onTeachPermissionRequest) {
    return errorResult(
      "Teach mode is not available in this session.",
      "feature_unavailable"
    );
  }
  if (overrides.getTeachModeActive?.()) {
    return errorResult(
      "Teach mode is already active. To add more apps, end the current tour first, then call request_teach_access again with the full app list.",
      "teach_mode_conflict"
    );
  }
  const reason = requireString(args, "reason");
  if (reason instanceof Error) return errorResult(reason.message, "bad_args");
  if (tccState) {
    const req2 = {
      requestId: randomUUID(),
      reason,
      apps: [],
      screenshotFiltering: adapter.executor.capabilities.screenshotFiltering,
      tccState
    };
    await overrides.onTeachPermissionRequest(req2);
    const recheck = await adapter.ensureOsPermissions();
    if (recheck.granted) {
      return errorResult(
        "macOS Accessibility and Screen Recording are now both granted. Call request_teach_access again immediately \u2014 the next call will show the app selection list."
      );
    }
    const perms = recheck;
    const missing = [];
    if (!perms.accessibility) missing.push("Accessibility");
    if (!perms.screenRecording) missing.push("Screen Recording");
    return errorResult(
      `macOS ${missing.join(" and ")} permission(s) not yet granted. The permission panel has been shown. Once the user grants the missing permission(s), call request_teach_access again.`,
      "tcc_not_granted"
    );
  }
  const rawApps = args.apps;
  if (!Array.isArray(rawApps) || !rawApps.every((a) => typeof a === "string")) {
    return errorResult('"apps" must be an array of strings.', "bad_args");
  }
  const apps = rawApps;
  const {
    needDialog,
    skipDialogGrants,
    willHide,
    tieredApps,
    userDenied,
    policyDenied
  } = await buildAccessRequest(
    adapter,
    apps,
    overrides.allowedApps,
    new Set(overrides.userDeniedBundleIds),
    overrides.selectedDisplayId
  );
  if (needDialog.length === 0 && skipDialogGrants.length === 0) {
    return okJson(
      {
        granted: [],
        denied: [],
        ...policyDenied.length > 0 && {
          policyDenied: {
            apps: policyDenied,
            guidance: buildPolicyDeniedGuidance(policyDenied)
          }
        },
        ...userDenied.length > 0 && {
          userDenied: {
            apps: userDenied,
            guidance: buildUserDeniedGuidance(userDenied)
          }
        },
        teachModeActive: false,
        screenshotFiltering: adapter.executor.capabilities.screenshotFiltering
      },
      { granted_count: 0, denied_count: 0 }
    );
  }
  const req = {
    requestId: randomUUID(),
    reason,
    apps: needDialog,
    screenshotFiltering: adapter.executor.capabilities.screenshotFiltering,
    ...willHide.length > 0 && {
      willHide,
      autoUnhideEnabled: adapter.getAutoUnhideEnabled()
    }
  };
  const response = await overrides.onTeachPermissionRequest(req);
  const granted = [...skipDialogGrants, ...response.granted];
  const teachModeActive = response.userConsented === true && granted.length > 0;
  if (teachModeActive) {
    overrides.onTeachModeActivated?.();
  }
  const grantedBundleIds = new Set(granted.map((g) => g.bundleId));
  const grantedTieredApps = tieredApps.filter(
    (t) => grantedBundleIds.has(t.bundleId)
  );
  return okJson(
    {
      granted,
      denied: response.denied,
      ...policyDenied.length > 0 && {
        policyDenied: {
          apps: policyDenied,
          guidance: buildPolicyDeniedGuidance(policyDenied)
        }
      },
      ...userDenied.length > 0 && {
        userDenied: {
          apps: userDenied,
          guidance: buildUserDeniedGuidance(userDenied)
        }
      },
      ...grantedTieredApps.length > 0 && {
        tierGuidance: buildTierGuidanceMessage(grantedTieredApps)
      },
      teachModeActive,
      screenshotFiltering: adapter.executor.capabilities.screenshotFiltering
    },
    {
      // response.granted only — skipDialogGrants are idempotent re-grants.
      // See handleRequestAccess's parallel comment.
      granted_count: response.granted.length,
      denied_count: response.denied.length,
      ...tierAssignmentTelemetry(grantedTieredApps)
    }
  );
}
async function validateTeachStepArgs(raw, adapter, overrides, label) {
  const explanation = requireString(raw, "explanation");
  if (explanation instanceof Error) {
    return new Error(`${label}: ${explanation.message}`);
  }
  const nextPreview = requireString(raw, "next_preview");
  if (nextPreview instanceof Error) {
    return new Error(`${label}: ${nextPreview.message}`);
  }
  const actions = raw.actions;
  if (!Array.isArray(actions)) {
    return new Error(`${label}: "actions" must be an array (empty is allowed).`);
  }
  for (const [i, act] of actions.entries()) {
    if (typeof act !== "object" || act === null) {
      return new Error(`${label}: actions[${i}] must be an object`);
    }
    const action = act.action;
    if (typeof action !== "string") {
      return new Error(`${label}: actions[${i}].action must be a string`);
    }
    if (!BATCHABLE_ACTIONS.has(action)) {
      return new Error(
        `${label}: actions[${i}].action="${action}" is not allowed. Allowed: ${[...BATCHABLE_ACTIONS].join(", ")}.`
      );
    }
  }
  let anchorLogical;
  if (raw.anchor !== void 0) {
    const anchor = raw.anchor;
    if (!Array.isArray(anchor) || anchor.length !== 2 || typeof anchor[0] !== "number" || typeof anchor[1] !== "number" || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) {
      return new Error(
        `${label}: "anchor" must be a [x, y] number tuple or omitted.`
      );
    }
    const display = await adapter.executor.getDisplaySize(
      overrides.selectedDisplayId
    );
    anchorLogical = scaleCoord(
      anchor[0],
      anchor[1],
      overrides.coordinateMode,
      display,
      overrides.lastScreenshot,
      adapter.logger
    );
  }
  return {
    explanation,
    nextPreview,
    anchorLogical,
    actions
  };
}
async function executeTeachStep(step, adapter, overrides, subGates) {
  const stepResult = await overrides.onTeachStep({
    explanation: step.explanation,
    nextPreview: step.nextPreview,
    anchorLogical: step.anchorLogical
  });
  if (stepResult.action === "exit") {
    await releaseHeldMouse(adapter);
    return { kind: "exit" };
  }
  overrides.onTeachWorking?.();
  if (step.actions.length === 0) {
    return { kind: "ok", results: [] };
  }
  if (subGates.hideBeforeAction) {
    const hidden = await adapter.executor.prepareForAction(
      overrides.allowedApps.map((a) => a.bundleId),
      overrides.selectedDisplayId
    );
    if (hidden.length > 0) {
      overrides.onAppsHidden?.(hidden);
    }
  }
  const stepSubGates = {
    ...subGates,
    hideBeforeAction: false,
    pixelValidation: false,
    // Anchors are pre-computed against the display at batch start.
    // A mid-batch resolver switch would break tooltip positioning.
    autoTargetDisplay: false
  };
  const results = [];
  for (const [i, act] of step.actions.entries()) {
    if (overrides.isAborted?.()) {
      await releaseHeldMouse(adapter);
      return { kind: "exit" };
    }
    if (i > 0) await sleep(10);
    const action = act.action;
    const { screenshot: _dropped, ...inner } = await dispatchAction(
      action,
      act,
      adapter,
      overrides,
      stepSubGates
    );
    const text = firstTextContent(inner);
    const result = { action, ok: !inner.isError, output: text };
    results.push(result);
    if (inner.isError) {
      await releaseHeldMouse(adapter);
      return {
        kind: "action_error",
        executed: results.length - 1,
        failed: result,
        remaining: step.actions.length - results.length,
        telemetry: inner.telemetry
      };
    }
  }
  return { kind: "ok", results };
}
async function appendTeachScreenshot(resultJson, adapter, overrides, subGates) {
  const shotResult = await handleScreenshot(adapter, overrides, subGates);
  if (shotResult.isError) {
    return okJson(resultJson);
  }
  return {
    content: [
      { type: "text", text: JSON.stringify(resultJson) },
      // handleScreenshot's content is [maybeMonitorNote, maybeHiddenNote,
      // image]. Spread all — both notes are useful context and the model
      // expects them alongside screenshots.
      ...shotResult.content
    ],
    // For serverDef.ts to stash. Next teach_step.anchor scales against this.
    screenshot: shotResult.screenshot
  };
}
async function handleTeachStep(adapter, args, overrides, subGates) {
  if (!overrides.onTeachStep) {
    return errorResult(
      "Teach mode is not active. Call request_teach_access first.",
      "teach_mode_not_active"
    );
  }
  const step = await validateTeachStepArgs(
    args,
    adapter,
    overrides,
    "teach_step"
  );
  if (step instanceof Error) return errorResult(step.message, "bad_args");
  const outcome = await executeTeachStep(step, adapter, overrides, subGates);
  if (outcome.kind === "exit") {
    return okJson({ exited: true });
  }
  if (outcome.kind === "action_error") {
    return okJson(
      {
        executed: outcome.executed,
        failed: outcome.failed,
        remaining: outcome.remaining
      },
      outcome.telemetry
    );
  }
  if (step.actions.length === 0) {
    return okJson({ executed: 0, results: [] });
  }
  return appendTeachScreenshot(
    { executed: outcome.results.length, results: outcome.results },
    adapter,
    overrides,
    subGates
  );
}
async function handleTeachBatch(adapter, args, overrides, subGates) {
  if (!overrides.onTeachStep) {
    return errorResult(
      "Teach mode is not active. Call request_teach_access first.",
      "teach_mode_not_active"
    );
  }
  const rawSteps = args.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1) {
    return errorResult('"steps" must be a non-empty array.', "bad_args");
  }
  const steps = [];
  for (const [i, raw] of rawSteps.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return errorResult(`steps[${i}] must be an object`, "bad_args");
    }
    const v = await validateTeachStepArgs(
      raw,
      adapter,
      overrides,
      `steps[${i}]`
    );
    if (v instanceof Error) return errorResult(v.message, "bad_args");
    steps.push(v);
  }
  const allResults = [];
  for (const [i, step] of steps.entries()) {
    const outcome = await executeTeachStep(step, adapter, overrides, subGates);
    if (outcome.kind === "exit") {
      return okJson({ exited: true, stepsCompleted: i });
    }
    if (outcome.kind === "action_error") {
      return okJson(
        {
          stepsCompleted: i,
          stepFailed: i,
          executed: outcome.executed,
          failed: outcome.failed,
          remaining: outcome.remaining,
          results: allResults
        },
        outcome.telemetry
      );
    }
    allResults.push(outcome.results);
  }
  const screenChanged = steps.some((s) => s.actions.length > 0);
  const resultJson = { stepsCompleted: steps.length, results: allResults };
  if (!screenChanged) {
    return okJson(resultJson);
  }
  return appendTeachScreenshot(resultJson, adapter, overrides, subGates);
}
async function buildHiddenNote(adapter, hiddenSinceLastSeen) {
  if (hiddenSinceLastSeen.length === 0) return void 0;
  const running = await adapter.executor.listRunningApps();
  const nameOf = new Map(running.map((a) => [a.bundleId, a.displayName]));
  const names = hiddenSinceLastSeen.map((id) => nameOf.get(id) ?? id);
  const list = names.map((n) => `"${n}"`).join(", ");
  const one = names.length === 1;
  return `${list} ${one ? "was" : "were"} open and got hidden before this screenshot (not in the session allowlist). If a previous action was meant to open ${one ? "it" : "one of them"}, that's why you don't see it \u2014 call request_access to add ${one ? "it" : "them"} to the allowlist.`;
}
function uniqueDisplayLabels(displays) {
  const sorted = [...displays].sort((a, b) => a.displayId - b.displayId);
  const counts = /* @__PURE__ */ new Map();
  const out = /* @__PURE__ */ new Map();
  for (const d of sorted) {
    const base = d.label ?? `display ${d.displayId}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    out.set(d.displayId, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}
async function buildMonitorNote(adapter, shotDisplayId, lastDisplayId, canSwitchDisplay) {
  let displays;
  try {
    displays = await adapter.executor.listDisplays();
  } catch (e) {
    adapter.logger.warn(`[computer-use] listDisplays failed: ${String(e)}`);
    return void 0;
  }
  if (displays.length < 2) return void 0;
  const labels = uniqueDisplayLabels(displays);
  const nameOf = (id) => labels.get(id) ?? `display ${id}`;
  const current = nameOf(shotDisplayId);
  const others = displays.filter((d) => d.displayId !== shotDisplayId).map((d) => nameOf(d.displayId));
  const switchHint = canSwitchDisplay ? " Use switch_display to capture a different monitor." : "";
  const othersList = others.length > 0 ? ` Other attached monitors: ${others.map((n) => `"${n}"`).join(", ")}.` + switchHint : "";
  if (lastDisplayId === void 0 || lastDisplayId === 0) {
    return `This screenshot was taken on monitor "${current}".` + othersList;
  }
  if (lastDisplayId !== shotDisplayId) {
    const prev = nameOf(lastDisplayId);
    return `This screenshot was taken on monitor "${current}", which is different from your previous screenshot (taken on "${prev}").` + othersList;
  }
  return void 0;
}
async function handleScreenshot(adapter, overrides, subGates) {
  if (overrides.allowedApps.length === 0) {
    return errorResult(
      "No applications are granted for this session. Call request_access first.",
      "allowlist_empty"
    );
  }
  if (subGates.autoTargetDisplay) {
    const allowedBundleIds2 = overrides.allowedApps.map((a) => a.bundleId);
    const currentAppSetKey = allowedBundleIds2.slice().sort().join(",");
    const appSetChanged = currentAppSetKey !== overrides.displayResolvedForApps;
    const autoResolve = !overrides.displayPinnedByModel && appSetChanged;
    const result = await adapter.executor.resolvePrepareCapture({
      allowedBundleIds: allowedBundleIds2,
      preferredDisplayId: overrides.selectedDisplayId,
      autoResolve,
      // Keep the hideBeforeAction sub-gate independently rollable —
      // atomic path honors the same toggle the non-atomic path checks
      // at the prepareForAction call site.
      doHide: subGates.hideBeforeAction
    });
    if (result.captureError === void 0 && decodedByteLength(result.base64) < MIN_SCREENSHOT_BYTES) {
      adapter.logger.warn(
        `[computer-use] resolvePrepareCapture result implausibly small (${decodedByteLength(result.base64)} bytes decoded) \u2014 possible transient display state`
      );
    }
    if (result.displayId !== overrides.selectedDisplayId) {
      adapter.logger.debug(
        `[computer-use] resolver: preferred=${overrides.selectedDisplayId} resolved=${result.displayId}`
      );
      overrides.onResolvedDisplayUpdated?.(result.displayId);
    }
    if (autoResolve) {
      overrides.onDisplayResolvedForApps?.(currentAppSetKey);
    }
    let hiddenSinceLastSeen2 = [];
    if (overrides.lastScreenshot !== void 0) {
      hiddenSinceLastSeen2 = result.hidden;
    }
    if (result.hidden.length > 0) {
      overrides.onAppsHidden?.(result.hidden);
    }
    if (result.captureError !== void 0) {
      return errorResult(result.captureError, "capture_failed");
    }
    const hiddenNote2 = await buildHiddenNote(adapter, hiddenSinceLastSeen2);
    const shot2 = {
      base64: result.base64,
      width: result.width,
      height: result.height,
      displayWidth: result.displayWidth,
      displayHeight: result.displayHeight,
      displayId: result.displayId,
      originX: result.originX,
      originY: result.originY
    };
    const monitorNote2 = await buildMonitorNote(
      adapter,
      shot2.displayId ?? 0,
      overrides.lastScreenshot?.displayId,
      overrides.onDisplayPinned !== void 0
    );
    return {
      content: [
        ...monitorNote2 ? [{ type: "text", text: monitorNote2 }] : [],
        ...hiddenNote2 ? [{ type: "text", text: hiddenNote2 }] : [],
        // Accessibility snapshot: structured GUI element tree (Windows bound-window mode)
        ...shot2.accessibilityText ? [
          {
            type: "text",
            text: `GUI elements in this window:
${shot2.accessibilityText}`
          }
        ] : [],
        {
          type: "image",
          data: shot2.base64,
          mimeType: detectMimeFromBase64(shot2.base64)
        }
      ],
      screenshot: shot2
    };
  }
  let hiddenSinceLastSeen = [];
  if (subGates.hideBeforeAction) {
    const hidden = await adapter.executor.prepareForAction(
      overrides.allowedApps.map((a) => a.bundleId),
      overrides.selectedDisplayId
    );
    if (overrides.lastScreenshot !== void 0) {
      hiddenSinceLastSeen = hidden;
    }
    if (hidden.length > 0) {
      overrides.onAppsHidden?.(hidden);
    }
  }
  const allowedBundleIds = overrides.allowedApps.map((g) => g.bundleId);
  const shot = await takeScreenshotWithRetry(
    adapter.executor,
    allowedBundleIds,
    adapter.logger,
    overrides.selectedDisplayId
  );
  const hiddenNote = await buildHiddenNote(adapter, hiddenSinceLastSeen);
  const monitorNote = await buildMonitorNote(
    adapter,
    shot.displayId ?? 0,
    overrides.lastScreenshot?.displayId,
    overrides.onDisplayPinned !== void 0
  );
  return {
    content: [
      ...monitorNote ? [{ type: "text", text: monitorNote }] : [],
      ...hiddenNote ? [{ type: "text", text: hiddenNote }] : [],
      // Accessibility snapshot: structured GUI element tree (Windows bound-window mode)
      ...shot.accessibilityText ? [
        {
          type: "text",
          text: `GUI elements in this window:
${shot.accessibilityText}`
        }
      ] : [],
      {
        type: "image",
        data: shot.base64,
        mimeType: detectMimeFromBase64(shot.base64)
      }
    ],
    // Piggybacked for serverDef.ts to stash on InternalServerContext.
    screenshot: shot
  };
}
async function handleZoom(adapter, args, overrides) {
  const region = args.region;
  if (!Array.isArray(region) || region.length !== 4) {
    return errorResult(
      "region must be an array of length 4: [x0, y0, x1, y1]",
      "bad_args"
    );
  }
  const [x0, y0, x1, y1] = region;
  if (![x0, y0, x1, y1].every((v) => typeof v === "number" && v >= 0)) {
    return errorResult("region values must be non-negative numbers", "bad_args");
  }
  if (x1 <= x0)
    return errorResult("region x1 must be greater than x0", "bad_args");
  if (y1 <= y0)
    return errorResult("region y1 must be greater than y0", "bad_args");
  const last = overrides.lastScreenshot;
  if (!last) {
    return errorResult(
      "take a screenshot before zooming (region coords are relative to it)",
      "state_conflict"
    );
  }
  if (x1 > last.width || y1 > last.height) {
    return errorResult(
      `region exceeds screenshot bounds (${last.width}\xD7${last.height})`,
      "bad_args"
    );
  }
  const ratioX = last.displayWidth / last.width;
  const ratioY = last.displayHeight / last.height;
  const regionLogical = {
    x: x0 * ratioX,
    y: y0 * ratioY,
    w: (x1 - x0) * ratioX,
    h: (y1 - y0) * ratioY
  };
  const allowedIds = overrides.allowedApps.map((g) => g.bundleId);
  const zoomed = await adapter.executor.zoom(
    regionLogical,
    allowedIds,
    last.displayId
  );
  return {
    content: [
      {
        type: "image",
        data: zoomed.base64,
        mimeType: detectMimeFromBase64(zoomed.base64)
      }
    ]
  };
}
async function handleClickVariant(adapter, args, overrides, subGates, button, count) {
  if (mouseButtonHeld) {
    await adapter.executor.mouseUp();
    mouseButtonHeld = false;
    mouseMoved = false;
  }
  const coord = extractCoordinate(args);
  if (coord instanceof Error) return errorResult(coord.message, "bad_args");
  const [rawX, rawY] = coord;
  let modifiers;
  if (args.text !== void 0) {
    if (typeof args.text !== "string") {
      return errorResult("text must be a string", "bad_args");
    }
    if (isSystemKeyCombo(args.text, adapter.executor.capabilities.platform) && !overrides.grantFlags.systemKeyCombos) {
      return errorResult(
        `The modifier chord "${args.text}" would fire a system shortcut. Request the systemKeyCombos grant flag via request_access, or use only modifier keys (shift, ctrl, alt, cmd) in the text parameter.`,
        "grant_flag_required"
      );
    }
    modifiers = parseKeyChord(args.text);
  }
  const clickActionKind = button !== "left" || modifiers !== void 0 && modifiers.length > 0 ? "mouse_full" : "mouse";
  const gate = await runInputActionGates(
    adapter,
    overrides,
    subGates,
    clickActionKind
  );
  if (gate) return gate;
  const display = await adapter.executor.getDisplaySize(
    overrides.selectedDisplayId
  );
  if (subGates.pixelValidation) {
    const { xPct, yPct } = coordToPercentageForPixelCompare(
      rawX,
      rawY,
      overrides.coordinateMode,
      overrides.lastScreenshot
    );
    const validation = await validateClickTarget(
      adapter.cropRawPatch,
      overrides.lastScreenshot,
      xPct,
      yPct,
      async () => {
        const allowedIds = overrides.allowedApps.map((g) => g.bundleId);
        try {
          return await adapter.executor.screenshot({
            allowedBundleIds: allowedIds,
            displayId: overrides.lastScreenshot?.displayId
          });
        } catch {
          return null;
        }
      },
      adapter.logger
    );
    if (!validation.valid && validation.warning) {
      return okText(validation.warning);
    }
  }
  const { x, y } = scaleCoord(
    rawX,
    rawY,
    overrides.coordinateMode,
    display,
    overrides.lastScreenshot,
    adapter.logger
  );
  const hitGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    x,
    y,
    clickActionKind
  );
  if (hitGate) return hitGate;
  await adapter.executor.click(x, y, button, count, modifiers);
  return okText("Clicked.");
}
async function handleType(adapter, args, overrides, subGates) {
  const text = requireString(args, "text");
  if (text instanceof Error) return errorResult(text.message, "bad_args");
  const gate = await runInputActionGates(
    adapter,
    overrides,
    subGates,
    "keyboard"
  );
  if (gate) return gate;
  const viaClipboard = text.includes("\n") && overrides.grantFlags.clipboardWrite && subGates.clipboardPasteMultiline;
  if (viaClipboard) {
    await adapter.executor.type(text, { viaClipboard: true });
    return okText("Typed (via clipboard).");
  }
  const graphemes = segmentGraphemes(text);
  for (const [i, g] of graphemes.entries()) {
    if (overrides.isAborted?.()) {
      return errorResult(
        `Typing aborted after ${i} of ${graphemes.length} graphemes (user interrupt).`
      );
    }
    await sleep(INTER_GRAPHEME_SLEEP_MS);
    if (g === "\n" || g === "\r" || g === "\r\n") {
      await adapter.executor.key("return");
    } else if (g === "	") {
      await adapter.executor.key("tab");
    } else {
      await adapter.executor.type(g, { viaClipboard: false });
    }
  }
  return okText(`Typed ${graphemes.length} grapheme(s).`);
}
async function handleKey(adapter, args, overrides, subGates) {
  const keySequence = requireString(args, "text");
  if (keySequence instanceof Error)
    return errorResult("text is required", "bad_args");
  let repeat;
  if (args.repeat !== void 0) {
    if (typeof args.repeat !== "number" || !Number.isInteger(args.repeat) || args.repeat < 1) {
      return errorResult("repeat must be a positive integer", "bad_args");
    }
    if (args.repeat > 100) {
      return errorResult("repeat exceeds maximum of 100", "bad_args");
    }
    repeat = args.repeat;
  }
  if (isSystemKeyCombo(keySequence, adapter.executor.capabilities.platform) && !overrides.grantFlags.systemKeyCombos) {
    return errorResult(
      `"${keySequence}" is a system-level shortcut. Request the \`systemKeyCombos\` grant via request_access to use it.`,
      "grant_flag_required"
    );
  }
  const gate = await runInputActionGates(
    adapter,
    overrides,
    subGates,
    "keyboard"
  );
  if (gate) return gate;
  await adapter.executor.key(keySequence, repeat);
  return okText("Key pressed.");
}
async function handleScroll(adapter, args, overrides, subGates) {
  const coord = extractCoordinate(args);
  if (coord instanceof Error) return errorResult(coord.message, "bad_args");
  const [rawX, rawY] = coord;
  const dir = args.scroll_direction;
  if (dir !== "up" && dir !== "down" && dir !== "left" && dir !== "right") {
    return errorResult(
      "scroll_direction must be 'up', 'down', 'left', or 'right'",
      "bad_args"
    );
  }
  const amount = args.scroll_amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
    return errorResult("scroll_amount must be a non-negative int", "bad_args");
  }
  if (amount > 100) {
    return errorResult("scroll_amount exceeds maximum of 100", "bad_args");
  }
  const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
  const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
  const gate = await runInputActionGates(adapter, overrides, subGates, "mouse");
  if (gate) return gate;
  const display = await adapter.executor.getDisplaySize(
    overrides.selectedDisplayId
  );
  const { x, y } = scaleCoord(
    rawX,
    rawY,
    overrides.coordinateMode,
    display,
    overrides.lastScreenshot,
    adapter.logger
  );
  const hitGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    x,
    y,
    mouseButtonHeld ? "mouse_full" : "mouse"
  );
  if (hitGate) return hitGate;
  if (mouseButtonHeld) mouseMoved = true;
  await adapter.executor.scroll(x, y, dx, dy);
  return okText("Scrolled.");
}
async function handleDrag(adapter, args, overrides, subGates) {
  if (mouseButtonHeld) {
    await adapter.executor.mouseUp();
    mouseButtonHeld = false;
    mouseMoved = false;
  }
  const endCoord = extractCoordinate(args, "coordinate");
  if (endCoord instanceof Error)
    return errorResult(endCoord.message, "bad_args");
  const rawTo = endCoord;
  let rawFrom;
  if (args.start_coordinate !== void 0) {
    const startCoord = extractCoordinate(args, "start_coordinate");
    if (startCoord instanceof Error)
      return errorResult(startCoord.message, "bad_args");
    rawFrom = startCoord;
  }
  const gate = await runInputActionGates(adapter, overrides, subGates, "mouse");
  if (gate) return gate;
  const display = await adapter.executor.getDisplaySize(
    overrides.selectedDisplayId
  );
  const from = rawFrom === void 0 ? void 0 : scaleCoord(
    rawFrom[0],
    rawFrom[1],
    overrides.coordinateMode,
    display,
    overrides.lastScreenshot,
    adapter.logger
  );
  const to = scaleCoord(
    rawTo[0],
    rawTo[1],
    overrides.coordinateMode,
    display,
    overrides.lastScreenshot,
    adapter.logger
  );
  const fromPoint = from ?? await adapter.executor.getCursorPosition();
  const fromGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    fromPoint.x,
    fromPoint.y,
    "mouse"
  );
  if (fromGate) return fromGate;
  const toGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    to.x,
    to.y,
    "mouse_full"
  );
  if (toGate) return toGate;
  await adapter.executor.drag(from, to);
  return okText("Dragged.");
}
async function handleMoveMouse(adapter, args, overrides, subGates) {
  const coord = extractCoordinate(args);
  if (coord instanceof Error) return errorResult(coord.message, "bad_args");
  const [rawX, rawY] = coord;
  const actionKind = mouseButtonHeld ? "mouse" : "mouse_position";
  const gate = await runInputActionGates(
    adapter,
    overrides,
    subGates,
    actionKind
  );
  if (gate) return gate;
  const display = await adapter.executor.getDisplaySize(
    overrides.selectedDisplayId
  );
  const { x, y } = scaleCoord(
    rawX,
    rawY,
    overrides.coordinateMode,
    display,
    overrides.lastScreenshot,
    adapter.logger
  );
  if (mouseButtonHeld) {
    const hitGate = await runHitTestGate(
      adapter,
      overrides,
      subGates,
      x,
      y,
      "mouse_full"
    );
    if (hitGate) return hitGate;
  }
  await adapter.executor.moveMouse(x, y);
  if (mouseButtonHeld) mouseMoved = true;
  return okText("Moved.");
}
async function handleOpenApplication(adapter, args, overrides) {
  const app = requireString(args, "app");
  if (app instanceof Error) return errorResult(app.message, "bad_args");
  const allowed = new Set(overrides.allowedApps.map((g) => g.bundleId));
  let targetBundleId;
  if (looksLikeBundleId(app) && allowed.has(app)) {
    targetBundleId = app;
  } else {
    const match = overrides.allowedApps.find(
      (g) => g.displayName.toLowerCase() === app.toLowerCase()
    );
    targetBundleId = match?.bundleId;
  }
  if (!targetBundleId || !allowed.has(targetBundleId)) {
    return errorResult(
      `"${app}" is not granted for this session. Call request_access first.`,
      "app_not_granted"
    );
  }
  await adapter.executor.openApp(targetBundleId);
  if (overrides.onDisplayPinned !== void 0) {
    let displayCount = 1;
    try {
      displayCount = (await adapter.executor.listDisplays()).length;
    } catch {
    }
    if (displayCount >= 2) {
      return okText(
        `Opened "${app}". If it isn't visible in the next screenshot, it may have opened on a different monitor \u2014 use switch_display to check.`
      );
    }
  }
  return okText(`Opened "${app}".`);
}
async function handleVirtualMouse(adapter, args) {
  if (!adapter.executor.virtualMouse) {
    return errorResult(
      "virtual_mouse is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const action = requireString(args, "action");
  if (action instanceof Error) return errorResult(action.message, "bad_args");
  const coord = args.coordinate;
  if (!Array.isArray(coord) || coord.length < 2) {
    return errorResult("coordinate [x, y] is required.", "bad_args");
  }
  const validActions = /* @__PURE__ */ new Set([
    "click",
    "double_click",
    "right_click",
    "move",
    "drag",
    "down",
    "up"
  ]);
  if (!validActions.has(action)) {
    return errorResult(
      `Invalid action "${action}". Valid: ${[...validActions].join(", ")}`,
      "bad_args"
    );
  }
  const startCoord = Array.isArray(args.start_coordinate) ? args.start_coordinate : void 0;
  const ok = await adapter.executor.virtualMouse({
    action,
    x: coord[0],
    y: coord[1],
    startX: startCoord?.[0],
    startY: startCoord?.[1]
  });
  if (!ok) {
    return errorResult("No window is currently bound.", "bad_args");
  }
  const desc = {
    click: `Click at (${coord[0]},${coord[1]})`,
    double_click: `Double-click at (${coord[0]},${coord[1]})`,
    right_click: `Right-click at (${coord[0]},${coord[1]})`,
    move: `Moved to (${coord[0]},${coord[1]})`,
    drag: `Dragged ${startCoord ? `(${startCoord[0]},${startCoord[1]})` : "current"} \u2192 (${coord[0]},${coord[1]})`,
    down: `Button down at (${coord[0]},${coord[1]})`,
    up: `Button up at (${coord[0]},${coord[1]})`
  };
  return okText(desc[action] ?? action);
}
async function handleVirtualKeyboard(adapter, args) {
  if (!adapter.executor.virtualKeyboard) {
    return errorResult(
      "virtual_keyboard is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const action = requireString(args, "action");
  if (action instanceof Error) return errorResult(action.message, "bad_args");
  const text = requireString(args, "text");
  if (text instanceof Error) return errorResult(text.message, "bad_args");
  const validActions = /* @__PURE__ */ new Set(["type", "combo", "press", "release", "hold"]);
  if (!validActions.has(action)) {
    return errorResult(
      `Invalid action "${action}". Valid: ${[...validActions].join(", ")}`,
      "bad_args"
    );
  }
  const duration = typeof args.duration === "number" ? args.duration : void 0;
  const repeat = typeof args.repeat === "number" ? args.repeat : void 0;
  const ok = await adapter.executor.virtualKeyboard({
    action,
    text,
    duration,
    repeat
  });
  if (!ok) {
    return errorResult(
      "No window is currently bound. Use open_application or bind_window first.",
      "bad_args"
    );
  }
  const desc = {
    type: `Typed "${text.length > 40 ? text.slice(0, 40) + "..." : text}"`,
    combo: `Sent ${text}`,
    press: `Pressed ${text} (holding)`,
    release: `Released ${text}`,
    hold: `Held ${text} for ${duration ?? 1}s`
  };
  return okText(`${desc[action]}${repeat && repeat > 1 ? ` \xD7${repeat}` : ""}`);
}
async function handleStatusIndicator(adapter, args) {
  if (!adapter.executor.statusIndicator) {
    return errorResult(
      "status_indicator is only available on Windows.",
      "feature_unavailable"
    );
  }
  const action = requireString(args, "action");
  if (action instanceof Error) return errorResult(action.message, "bad_args");
  if (!["show", "hide", "status"].includes(action)) {
    return errorResult(
      `Invalid action "${action}". Valid: show, hide, status.`,
      "bad_args"
    );
  }
  const message = typeof args.message === "string" ? args.message : void 0;
  if (action === "show" && !message) {
    return errorResult("'show' requires a message parameter.", "bad_args");
  }
  const result = await adapter.executor.statusIndicator(action, message);
  if (action === "status") {
    return okText(
      result.active ? "Indicator is active on the bound window." : "Indicator is not active (no window bound)."
    );
  }
  if (action === "show") {
    return okText(`Indicator showing: "${message}"`);
  }
  return okText("Indicator hidden.");
}
async function handleMouseWheel(adapter, args) {
  if (!adapter.executor.mouseWheel) {
    return errorResult(
      "mouse_wheel is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const coord = args.coordinate;
  if (!Array.isArray(coord) || coord.length < 2) {
    return errorResult("coordinate must be [x, y] array.", "bad_args");
  }
  const delta = typeof args.delta === "number" ? args.delta : void 0;
  if (delta === void 0) {
    return errorResult(
      "delta is required (positive=up, negative=down).",
      "bad_args"
    );
  }
  const horizontal = args.direction === "horizontal";
  const ok = await adapter.executor.mouseWheel(
    coord[0],
    coord[1],
    delta,
    horizontal
  );
  if (!ok) {
    return errorResult(
      "No window is currently bound. Use open_application or bind_window first.",
      "bad_args"
    );
  }
  return okText(
    `Mouse wheel: ${horizontal ? "horizontal" : "vertical"} scroll ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} click(s) at (${coord[0]},${coord[1]}).`
  );
}
async function handleActivateWindow(adapter, args) {
  if (!adapter.executor.activateWindow) {
    return errorResult(
      "activate_window is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const clickX = typeof args.click_x === "number" ? args.click_x : void 0;
  const clickY = typeof args.click_y === "number" ? args.click_y : void 0;
  const ok = await adapter.executor.activateWindow(clickX, clickY);
  if (!ok) {
    return errorResult(
      "No window is currently bound. Use open_application or bind_window first.",
      "bad_args"
    );
  }
  return okText("Window activated and focused. Ready for input.");
}
async function handlePromptRespond(adapter, args) {
  if (!adapter.executor.respondToPrompt) {
    return errorResult(
      "prompt_respond is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const responseType = requireString(args, "response_type");
  if (responseType instanceof Error)
    return errorResult(responseType.message, "bad_args");
  const validTypes = /* @__PURE__ */ new Set(["yes", "no", "enter", "escape", "select", "type"]);
  if (!validTypes.has(responseType)) {
    return errorResult(
      `Invalid response_type "${responseType}". Valid: ${[...validTypes].join(", ")}`,
      "bad_args"
    );
  }
  if (responseType === "select" && typeof args.arrow_count !== "number") {
    return errorResult("'select' requires arrow_count parameter.", "bad_args");
  }
  if (responseType === "type" && typeof args.text !== "string") {
    return errorResult("'type' requires text parameter.", "bad_args");
  }
  const ok = await adapter.executor.respondToPrompt({
    responseType,
    arrowDirection: typeof args.arrow_direction === "string" ? args.arrow_direction : void 0,
    arrowCount: typeof args.arrow_count === "number" ? args.arrow_count : void 0,
    text: typeof args.text === "string" ? args.text : void 0
  });
  if (!ok) {
    return errorResult(
      "No window is currently bound. Use open_application or bind_window first.",
      "bad_args"
    );
  }
  const descriptions = {
    yes: "Sent 'y' + Enter.",
    no: "Sent 'n' + Enter.",
    enter: "Sent Enter.",
    escape: "Sent Escape.",
    select: `Navigated ${args.arrow_direction ?? "down"} ${args.arrow_count ?? 1} time(s) + Enter.`,
    type: `Typed "${args.text}" + Enter.`
  };
  return okText(
    `Prompt responded: ${descriptions[responseType] ?? responseType}. Take a screenshot to verify.`
  );
}
async function handleOpenTerminal(adapter, args) {
  if (!adapter.executor.openTerminal) {
    return errorResult(
      "open_terminal is only available on Windows.",
      "feature_unavailable"
    );
  }
  const agent = requireString(args, "agent");
  if (agent instanceof Error) return errorResult(agent.message, "bad_args");
  const validAgents = /* @__PURE__ */ new Set(["claude", "codex", "gemini", "custom"]);
  if (!validAgents.has(agent)) {
    return errorResult(
      `Invalid agent "${agent}". Valid: claude, codex, gemini, custom.`,
      "bad_args"
    );
  }
  if (agent === "custom" && typeof args.command !== "string") {
    return errorResult(
      "agent='custom' requires 'command' parameter.",
      "bad_args"
    );
  }
  const result = await adapter.executor.openTerminal({
    agent,
    command: typeof args.command === "string" ? args.command : void 0,
    terminal: typeof args.terminal === "string" ? args.terminal : void 0,
    workingDirectory: typeof args.working_directory === "string" ? args.working_directory : void 0
  });
  if (!result) {
    return errorResult(
      "Failed to open terminal. Windows Terminal (wt.exe) may not be installed.",
      "launch_failed"
    );
  }
  if (!result.launched) {
    return okText(
      `Terminal opened (hwnd=${result.hwnd}, "${result.title}") but no command was sent. Window is now bound.`
    );
  }
  const agentNames = {
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini",
    custom: args.command
  };
  return okText(
    `Terminal opened and ${agentNames[agent] ?? agent} launched.
Window: hwnd=${result.hwnd} "${result.title}"
Command: '${agent === "custom" ? args.command : agent}' + Enter
Status: bound to this terminal. Take a screenshot to verify the agent started.`
  );
}
async function handleBindWindow(adapter, args) {
  const action = requireString(args, "action");
  if (action instanceof Error) return errorResult(action.message, "bad_args");
  switch (action) {
    case "list": {
      if (!adapter.executor.listVisibleWindows) {
        return errorResult(
          "bind_window is only available on Windows.",
          "feature_unavailable"
        );
      }
      const windows = await adapter.executor.listVisibleWindows();
      if (windows.length === 0) return okText("No visible windows found.");
      const lines = windows.map((w) => `hwnd=${w.hwnd} pid=${w.pid} "${w.title}"`);
      return okText(`Visible windows (${windows.length}):
${lines.join("\n")}`);
    }
    case "status": {
      if (!adapter.executor.getBindingStatus) {
        return errorResult(
          "bind_window is only available on Windows.",
          "feature_unavailable"
        );
      }
      const status = await adapter.executor.getBindingStatus();
      if (!status || !status.bound) {
        return okText(
          "No window is currently bound. Use bind_window(action='list') to see available windows, then bind_window(action='bind', title='...') to bind."
        );
      }
      let text = `Bound to: hwnd=${status.hwnd}`;
      if (status.title) text += ` "${status.title}"`;
      if (status.pid) text += ` pid=${status.pid}`;
      if (status.rect)
        text += ` rect=(${status.rect.x},${status.rect.y} ${status.rect.width}x${status.rect.height})`;
      return okText(text);
    }
    case "bind": {
      if (!adapter.executor.bindToWindow) {
        return errorResult(
          "bind_window is only available on Windows.",
          "feature_unavailable"
        );
      }
      const title = typeof args.title === "string" ? args.title : void 0;
      const hwnd = typeof args.hwnd === "string" ? args.hwnd : void 0;
      const pid = typeof args.pid === "number" ? args.pid : void 0;
      if (!title && !hwnd && !pid) {
        return errorResult(
          "Specify at least one of: title, hwnd, or pid.",
          "bad_args"
        );
      }
      const result = await adapter.executor.bindToWindow({ hwnd, title, pid });
      if (!result) {
        return errorResult(
          `No window found matching: ${[title && `title="${title}"`, hwnd && `hwnd=${hwnd}`, pid && `pid=${pid}`].filter(Boolean).join(", ")}. Use bind_window(action='list') to see available windows.`,
          "element_not_found"
        );
      }
      return okText(
        `Bound to window: hwnd=${result.hwnd} pid=${result.pid} "${result.title}". All subsequent screenshot/click/type operations target this window.`
      );
    }
    case "unbind": {
      if (!adapter.executor.unbindFromWindow) {
        return errorResult(
          "bind_window is only available on Windows.",
          "feature_unavailable"
        );
      }
      await adapter.executor.unbindFromWindow();
      return okText(
        "Window binding released. Operations now target the full screen."
      );
    }
    default:
      return errorResult(
        `Unknown bind_window action "${action}". Valid: list, bind, unbind, status.`,
        "bad_args"
      );
  }
}
async function handleClickElement(adapter, args) {
  if (!adapter.executor.clickElement) {
    return errorResult(
      "click_element is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const name = typeof args.name === "string" ? args.name : void 0;
  const role = typeof args.role === "string" ? args.role : void 0;
  const automationId = typeof args.automationId === "string" ? args.automationId : void 0;
  if (!name && !role && !automationId) {
    return errorResult(
      "At least one of name, role, or automationId is required.",
      "bad_args"
    );
  }
  const ok = await adapter.executor.clickElement({ name, role, automationId });
  if (!ok) {
    return errorResult(
      `Element not found: ${[name && `name="${name}"`, role && `role=${role}`, automationId && `id=${automationId}`].filter(Boolean).join(", ")}. Take a screenshot to see current GUI elements.`,
      "element_not_found"
    );
  }
  return okText(
    `Clicked element: ${[name && `"${name}"`, role, automationId].filter(Boolean).join(" ")}`
  );
}
async function handleTypeIntoElement(adapter, args) {
  if (!adapter.executor.typeIntoElement) {
    return errorResult(
      "type_into_element is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  const text = requireString(args, "text");
  if (text instanceof Error) return errorResult(text.message, "bad_args");
  const name = typeof args.name === "string" ? args.name : void 0;
  const role = typeof args.role === "string" ? args.role : void 0;
  const automationId = typeof args.automationId === "string" ? args.automationId : void 0;
  const ok = await adapter.executor.typeIntoElement(
    { name, role, automationId },
    text
  );
  if (!ok) {
    return errorResult(
      `Could not type into element: ${[name && `name="${name}"`, role && `role=${role}`, automationId && `id=${automationId}`].filter(Boolean).join(", ")}. The element was not found or doesn't support text input.`,
      "element_not_found"
    );
  }
  return okText(
    `Typed ${text.length} chars into: ${[name && `"${name}"`, role, automationId].filter(Boolean).join(" ")}`
  );
}
async function handleWindowManagement(adapter, args) {
  const action = requireString(args, "action");
  if (action instanceof Error) return errorResult(action.message, "bad_args");
  const VALID_ACTIONS = /* @__PURE__ */ new Set([
    "minimize",
    "maximize",
    "restore",
    "close",
    "focus",
    "move_offscreen",
    "move_resize",
    "get_rect"
  ]);
  if (!VALID_ACTIONS.has(action)) {
    return errorResult(
      `Unknown window_management action "${action}". Valid: ${[...VALID_ACTIONS].join(", ")}`,
      "bad_args"
    );
  }
  if (!adapter.executor.manageWindow) {
    return errorResult(
      "window_management is only available on Windows with a bound window.",
      "feature_unavailable"
    );
  }
  if (action === "get_rect") {
    if (!adapter.executor.getWindowRect) {
      return errorResult("getWindowRect not available.", "feature_unavailable");
    }
    const rect = await adapter.executor.getWindowRect();
    if (!rect) {
      return errorResult(
        "No window is currently bound. Call open_application first.",
        "bad_args"
      );
    }
    return okText(
      `Window rect: x=${rect.x}, y=${rect.y}, width=${rect.width}, height=${rect.height}`
    );
  }
  if (action === "move_resize") {
    const x = typeof args.x === "number" ? args.x : void 0;
    const y = typeof args.y === "number" ? args.y : void 0;
    if (x === void 0 || y === void 0) {
      return errorResult("move_resize requires x and y parameters.", "bad_args");
    }
    const width = typeof args.width === "number" ? args.width : void 0;
    const height = typeof args.height === "number" ? args.height : void 0;
    const ok2 = await adapter.executor.manageWindow(action, {
      x,
      y,
      width,
      height
    });
    if (!ok2) {
      return errorResult(
        "No window is currently bound. Call open_application first.",
        "bad_args"
      );
    }
    return okText(
      width && height ? `Moved window to (${x}, ${y}) and resized to ${width}\xD7${height}.` : `Moved window to (${x}, ${y}).`
    );
  }
  const ok = await adapter.executor.manageWindow(action);
  if (!ok) {
    return errorResult(
      "No window is currently bound. Call open_application first.",
      "bad_args"
    );
  }
  const descriptions = {
    minimize: "Window minimized (ShowWindow SW_MINIMIZE).",
    maximize: "Window maximized (ShowWindow SW_MAXIMIZE).",
    restore: "Window restored (ShowWindow SW_RESTORE).",
    close: "Window closed (SendMessage WM_CLOSE). The window binding has been released.",
    focus: "Window brought to front (SetForegroundWindow).",
    move_offscreen: "Window moved offscreen (-32000,-32000). Still usable via SendMessage/PrintWindow."
  };
  return okText(descriptions[action] ?? `Action "${action}" completed.`);
}
async function handleSwitchDisplay(adapter, args, overrides) {
  const display = requireString(args, "display");
  if (display instanceof Error) return errorResult(display.message, "bad_args");
  if (!overrides.onDisplayPinned) {
    return errorResult(
      "Display switching is not available in this session.",
      "feature_unavailable"
    );
  }
  if (display.toLowerCase() === "auto") {
    overrides.onDisplayPinned(void 0);
    return okText(
      "Returned to automatic monitor selection. Call screenshot to continue."
    );
  }
  let displays;
  try {
    displays = await adapter.executor.listDisplays();
  } catch (e) {
    return errorResult(
      `Failed to enumerate displays: ${String(e)}`,
      "display_error"
    );
  }
  if (displays.length < 2) {
    return errorResult(
      "Only one monitor is connected. There is nothing to switch to.",
      "bad_args"
    );
  }
  const labels = uniqueDisplayLabels(displays);
  const wanted = display.toLowerCase();
  const target = displays.find(
    (d) => labels.get(d.displayId)?.toLowerCase() === wanted
  );
  if (!target) {
    const available = displays.map((d) => `"${labels.get(d.displayId)}"`).join(", ");
    return errorResult(
      `No monitor named "${display}" is connected. Available monitors: ${available}.`,
      "bad_args"
    );
  }
  overrides.onDisplayPinned(target.displayId);
  return okText(
    `Switched to monitor "${labels.get(target.displayId)}". Call screenshot to see it.`
  );
}
function handleListGrantedApplications(overrides) {
  return okJson({
    allowedApps: overrides.allowedApps,
    grantFlags: overrides.grantFlags
  });
}
async function handleReadClipboard(adapter, overrides, subGates) {
  if (!overrides.grantFlags.clipboardRead) {
    return errorResult(
      "Clipboard read is not granted. Request `clipboardRead` via request_access.",
      "grant_flag_required"
    );
  }
  if (subGates.clipboardGuard) {
    const frontmost = await adapter.executor.getFrontmostApp();
    const tierByBundleId = new Map(
      overrides.allowedApps.map((a) => [a.bundleId, a.tier])
    );
    const frontmostTier = frontmost ? tierByBundleId.get(frontmost.bundleId) : void 0;
    await syncClipboardStash(adapter, overrides, frontmostTier === "click");
  }
  const text = await adapter.executor.readClipboard();
  return okJson({ text });
}
async function handleWriteClipboard(adapter, args, overrides, subGates) {
  if (!overrides.grantFlags.clipboardWrite) {
    return errorResult(
      "Clipboard write is not granted. Request `clipboardWrite` via request_access.",
      "grant_flag_required"
    );
  }
  const text = requireString(args, "text");
  if (text instanceof Error) return errorResult(text.message, "bad_args");
  if (subGates.clipboardGuard) {
    const frontmost = await adapter.executor.getFrontmostApp();
    const tierByBundleId = new Map(
      overrides.allowedApps.map((a) => [a.bundleId, a.tier])
    );
    const frontmostTier = frontmost ? tierByBundleId.get(frontmost.bundleId) : void 0;
    if (frontmost && frontmostTier === "click") {
      return errorResult(
        `"${frontmost.displayName}" is a tier-"click" app and currently frontmost. write_clipboard is blocked because the next action would clear the clipboard anyway \u2014 a UI Paste button in this app cannot be used to inject text. Bring a tier-"full" app forward before writing to the clipboard.` + TIER_ANTI_SUBVERSION,
        "tier_insufficient"
      );
    }
    await syncClipboardStash(adapter, overrides, frontmostTier === "click");
  }
  await adapter.executor.writeClipboard(text);
  return okText("Clipboard written.");
}
async function handleWait(args) {
  const duration = args.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return errorResult("duration must be a number", "bad_args");
  }
  if (duration < 0) {
    return errorResult("duration must be non-negative", "bad_args");
  }
  if (duration > 100) {
    return errorResult(
      "duration is too long. Duration is in seconds.",
      "bad_args"
    );
  }
  await sleep(duration * 1e3);
  return okText(`Waited ${duration}s.`);
}
async function handleCursorPosition(adapter, overrides) {
  const logical = await adapter.executor.getCursorPosition();
  const shot = overrides.lastScreenshot;
  if (shot) {
    const localX = logical.x - shot.originX;
    const localY = logical.y - shot.originY;
    if (localX < 0 || localX > shot.displayWidth || localY < 0 || localY > shot.displayHeight) {
      return okJson({
        x: logical.x,
        y: logical.y,
        coordinateSpace: "logical_points",
        note: "cursor is on a different monitor than your last screenshot; take a fresh screenshot"
      });
    }
    const x = Math.round(localX * (shot.width / shot.displayWidth));
    const y = Math.round(localY * (shot.height / shot.displayHeight));
    return okJson({ x, y, coordinateSpace: "image_pixels" });
  }
  return okJson({
    x: logical.x,
    y: logical.y,
    coordinateSpace: "logical_points",
    note: "take a screenshot first for image-pixel coordinates"
  });
}
async function handleHoldKey(adapter, args, overrides, subGates) {
  const text = requireString(args, "text");
  if (text instanceof Error) return errorResult(text.message, "bad_args");
  const duration = args.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return errorResult("duration must be a number", "bad_args");
  }
  if (duration < 0) {
    return errorResult("duration must be non-negative", "bad_args");
  }
  if (duration > 100) {
    return errorResult(
      "duration is too long. Duration is in seconds.",
      "bad_args"
    );
  }
  if (isSystemKeyCombo(text, adapter.executor.capabilities.platform) && !overrides.grantFlags.systemKeyCombos) {
    return errorResult(
      `"${text}" is a system-level shortcut. Request the \`systemKeyCombos\` grant via request_access to use it.`,
      "grant_flag_required"
    );
  }
  const gate = await runInputActionGates(
    adapter,
    overrides,
    subGates,
    "keyboard"
  );
  if (gate) return gate;
  const keyNames = parseKeyChord(text);
  await adapter.executor.holdKey(keyNames, duration * 1e3);
  return okText("Key held.");
}
async function handleLeftMouseDown(adapter, overrides, subGates) {
  if (mouseButtonHeld) {
    return errorResult(
      "mouse button already held, call left_mouse_up first",
      "state_conflict"
    );
  }
  const gate = await runInputActionGates(adapter, overrides, subGates, "mouse");
  if (gate) return gate;
  const cursor = await adapter.executor.getCursorPosition();
  const hitGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    cursor.x,
    cursor.y,
    "mouse"
  );
  if (hitGate) return hitGate;
  await adapter.executor.mouseDown();
  mouseButtonHeld = true;
  mouseMoved = false;
  return okText("Mouse button pressed.");
}
async function handleLeftMouseUp(adapter, overrides, subGates) {
  const releaseFirst = async (err) => {
    await adapter.executor.mouseUp();
    mouseButtonHeld = false;
    mouseMoved = false;
    return err;
  };
  const gate = await runInputActionGates(adapter, overrides, subGates, "mouse");
  if (gate) return releaseFirst(gate);
  const cursor = await adapter.executor.getCursorPosition();
  const hitGate = await runHitTestGate(
    adapter,
    overrides,
    subGates,
    cursor.x,
    cursor.y,
    mouseMoved ? "mouse_full" : "mouse"
  );
  if (hitGate) return releaseFirst(hitGate);
  await adapter.executor.mouseUp();
  mouseButtonHeld = false;
  mouseMoved = false;
  return okText("Mouse button released.");
}
const BATCHABLE_ACTIONS = /* @__PURE__ */ new Set([
  "key",
  "type",
  "mouse_move",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "hold_key",
  "screenshot",
  "cursor_position",
  "left_mouse_down",
  "left_mouse_up",
  "wait"
]);
async function handleComputerBatch(adapter, args, overrides, subGates) {
  const actions = args.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return errorResult("actions must be a non-empty array", "bad_args");
  }
  for (const [i, act] of actions.entries()) {
    if (typeof act !== "object" || act === null) {
      return errorResult(`actions[${i}] must be an object`, "bad_args");
    }
    const action = act.action;
    if (typeof action !== "string") {
      return errorResult(`actions[${i}].action must be a string`, "bad_args");
    }
    if (!BATCHABLE_ACTIONS.has(action)) {
      return errorResult(
        `actions[${i}].action="${action}" is not allowed in a batch. Allowed: ${[...BATCHABLE_ACTIONS].join(", ")}.`,
        "bad_args"
      );
    }
  }
  if (subGates.hideBeforeAction) {
    const hidden = await adapter.executor.prepareForAction(
      overrides.allowedApps.map((a) => a.bundleId),
      overrides.selectedDisplayId
    );
    if (hidden.length > 0) {
      overrides.onAppsHidden?.(hidden);
    }
  }
  const batchSubGates = {
    ...subGates,
    hideBeforeAction: false,
    pixelValidation: false,
    // Batch already took its screenshot (appended at end); a mid-batch
    // resolver switch would make that screenshot inconsistent with
    // earlier clicks' lastScreenshot-based scaleCoord targeting.
    autoTargetDisplay: false
  };
  const results = [];
  for (const [i, act] of actions.entries()) {
    if (overrides.isAborted?.()) {
      await releaseHeldMouse(adapter);
      return errorResult(
        `Batch aborted after ${results.length} of ${actions.length} actions (user interrupt).`
      );
    }
    if (i > 0) await sleep(10);
    const actionArgs = act;
    const action = actionArgs.action;
    const { screenshot: _dropped, ...inner } = await dispatchAction(
      action,
      actionArgs,
      adapter,
      overrides,
      batchSubGates
    );
    const text = firstTextContent(inner);
    const result = { action, ok: !inner.isError, output: text };
    results.push(result);
    if (inner.isError) {
      await releaseHeldMouse(adapter);
      return okJson(
        {
          completed: results.slice(0, -1),
          failed: result,
          remaining: actions.length - results.length
        },
        inner.telemetry
      );
    }
  }
  return okJson({ completed: results });
}
function firstTextContent(r) {
  const first = r.content[0];
  return first && first.type === "text" ? first.text : "";
}
async function dispatchAction(name, a, adapter, overrides, subGates) {
  const hasBoundWindow = await adapter.executor.hasBoundWindow?.() === true && adapter.executor.virtualMouse && adapter.executor.virtualKeyboard;
  if (hasBoundWindow) {
    const coord = Array.isArray(a.coordinate) ? a.coordinate : void 0;
    switch (name) {
      case "left_click":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "click",
            coordinate: coord
          });
        break;
      case "double_click":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "double_click",
            coordinate: coord
          });
        break;
      case "right_click":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "right_click",
            coordinate: coord
          });
        break;
      case "mouse_move":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "move",
            coordinate: coord
          });
        break;
      case "left_click_drag":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "drag",
            coordinate: coord,
            start_coordinate: Array.isArray(a.start_coordinate) ? a.start_coordinate : void 0
          });
        break;
      case "left_mouse_down":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "down",
            coordinate: coord
          });
        break;
      case "left_mouse_up":
        if (coord)
          return handleVirtualMouse(adapter, {
            action: "up",
            coordinate: coord
          });
        break;
      case "type":
        if (typeof a.text === "string")
          return handleVirtualKeyboard(adapter, {
            action: "type",
            text: a.text
          });
        break;
      case "key":
        if (typeof a.text === "string")
          return handleVirtualKeyboard(adapter, {
            action: "combo",
            text: a.text,
            repeat: a.repeat
          });
        break;
      case "hold_key":
        if (typeof a.text === "string")
          return handleVirtualKeyboard(adapter, {
            action: "hold",
            text: a.text,
            duration: typeof a.duration === "number" ? a.duration : 1
          });
        break;
      case "scroll":
        if (coord)
          return handleMouseWheel(adapter, {
            coordinate: coord,
            delta: a.scroll_direction === "up" ? a.scroll_amount ?? 3 : -(a.scroll_amount ?? 3),
            direction: a.scroll_direction === "left" || a.scroll_direction === "right" ? "horizontal" : "vertical"
          });
        break;
    }
  }
  switch (name) {
    case "screenshot":
      return handleScreenshot(adapter, overrides, subGates);
    case "zoom":
      return handleZoom(adapter, a, overrides);
    case "left_click":
      return handleClickVariant(adapter, a, overrides, subGates, "left", 1);
    case "double_click":
      return handleClickVariant(adapter, a, overrides, subGates, "left", 2);
    case "triple_click":
      return handleClickVariant(adapter, a, overrides, subGates, "left", 3);
    case "right_click":
      return handleClickVariant(adapter, a, overrides, subGates, "right", 1);
    case "middle_click":
      return handleClickVariant(adapter, a, overrides, subGates, "middle", 1);
    case "type":
      return handleType(adapter, a, overrides, subGates);
    case "key":
      return handleKey(adapter, a, overrides, subGates);
    case "scroll":
      return handleScroll(adapter, a, overrides, subGates);
    case "left_click_drag":
      return handleDrag(adapter, a, overrides, subGates);
    case "mouse_move":
      return handleMoveMouse(adapter, a, overrides, subGates);
    case "wait":
      return handleWait(a);
    case "cursor_position":
      return handleCursorPosition(adapter, overrides);
    case "hold_key":
      return handleHoldKey(adapter, a, overrides, subGates);
    case "left_mouse_down":
      return handleLeftMouseDown(adapter, overrides, subGates);
    case "left_mouse_up":
      return handleLeftMouseUp(adapter, overrides, subGates);
    case "open_application":
      return handleOpenApplication(adapter, a, overrides);
    case "window_management":
      return handleWindowManagement(adapter, a);
    case "click_element":
      return handleClickElement(adapter, a);
    case "type_into_element":
      return handleTypeIntoElement(adapter, a);
    case "open_terminal":
      return handleOpenTerminal(adapter, a);
    case "bind_window":
      return handleBindWindow(adapter, a);
    case "virtual_mouse":
      return handleVirtualMouse(adapter, a);
    case "virtual_keyboard":
      return handleVirtualKeyboard(adapter, a);
    case "status_indicator":
      return handleStatusIndicator(adapter, a);
    case "mouse_wheel":
      return handleMouseWheel(adapter, a);
    case "activate_window":
      return handleActivateWindow(adapter, a);
    case "prompt_respond":
      return handlePromptRespond(adapter, a);
    case "switch_display":
      return handleSwitchDisplay(adapter, a, overrides);
    case "list_granted_applications":
      return handleListGrantedApplications(overrides);
    case "read_clipboard":
      return handleReadClipboard(adapter, overrides, subGates);
    case "write_clipboard":
      return handleWriteClipboard(adapter, a, overrides, subGates);
    case "computer_batch":
      return handleComputerBatch(adapter, a, overrides, subGates);
    default:
      return errorResult(`Unknown tool "${name}".`, "bad_args");
  }
}
async function handleToolCall(adapter, name, args, rawOverrides) {
  const { logger, serverName } = adapter;
  const userDeniedSet = new Set(rawOverrides.userDeniedBundleIds);
  const overrides = rawOverrides.allowedApps.some(
    (a2) => a2.tier === void 0 || userDeniedSet.has(a2.bundleId) || isPolicyDenied(a2.bundleId, a2.displayName)
  ) ? {
    ...rawOverrides,
    allowedApps: rawOverrides.allowedApps.filter((a2) => !userDeniedSet.has(a2.bundleId)).filter((a2) => !isPolicyDenied(a2.bundleId, a2.displayName)).map(
      (a2) => a2.tier !== void 0 ? a2 : { ...a2, tier: getDefaultTierForApp(a2.bundleId, a2.displayName) }
    )
  } : rawOverrides;
  if (adapter.isDisabled()) {
    return errorResult(
      "Computer control is disabled in Settings. Enable it and try again.",
      "other"
    );
  }
  const osPerms = await adapter.ensureOsPermissions();
  let tccState;
  if (!osPerms.granted) {
    if (name !== "request_access" && name !== "request_teach_access") {
      return errorResult(
        "Accessibility and Screen Recording permissions are required. Call request_access to show the permission panel.",
        "tcc_not_granted"
      );
    }
    tccState = {
      accessibility: osPerms.accessibility,
      screenRecording: osPerms.screenRecording
    };
  }
  const deferAcquire = defersLockAcquire(name);
  const lock = overrides.checkCuLock?.();
  if (lock) {
    if (lock.holder !== void 0 && !lock.isSelf) {
      return errorResult(
        "Another Claude session is currently using the computer. Wait for the user to acknowledge it is finished (stop button in the Claude window), or find a non-computer-use approach if one is readily apparent.",
        "cu_lock_held"
      );
    }
    if (lock.holder === void 0 && !deferAcquire) {
      overrides.acquireCuLock?.();
      resetMouseButtonHeld();
    }
  }
  const subGates = adapter.getSubGates();
  const a = asRecord(args);
  logger.silly(
    `[${serverName}] tool=${name} args=${JSON.stringify(a).slice(0, 200)}`
  );
  try {
    if (name === "request_access") {
      return await handleRequestAccess(adapter, a, overrides, tccState);
    }
    if (name === "request_teach_access") {
      return await handleRequestTeachAccess(adapter, a, overrides, tccState);
    }
    if (name === "teach_step") {
      return await handleTeachStep(adapter, a, overrides, subGates);
    }
    if (name === "teach_batch") {
      return await handleTeachBatch(adapter, a, overrides, subGates);
    }
    return await dispatchAction(name, a, adapter, overrides, subGates);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[${serverName}] tool=${name} threw: ${msg}`,
      toLoggerDetail(err)
    );
    return errorResult(`Tool "${name}" failed: ${msg}`, "executor_threw");
  }
}
const _test = {
  scaleCoord,
  coordToPercentageForPixelCompare,
  segmentGraphemes,
  decodedByteLength,
  resolveRequestedApps,
  buildAccessRequest,
  buildTierGuidanceMessage,
  buildUserDeniedGuidance,
  tierSatisfies,
  looksLikeBundleId,
  extractCoordinate,
  parseKeyChord,
  buildMonitorNote,
  handleSwitchDisplay,
  uniqueDisplayLabels
};
export {
  _test,
  defersLockAcquire,
  handleToolCall,
  resetMouseButtonHeld
};
