/**
 * Official Simulator installAndLaunch / attach residual body (honest).
 *
 * Validators (app.asar):
 *   Ysr(req): { udid: string, appPath: string, bundleId?: string, kind?: string }
 *   Usr(device): { kind?, udid, name, state, osVersion }
 *   AmA(attachment): { kind?, udid, deviceName, streamUrl, pointWidth, pointHeight, streamMode? }
 *
 * Official full stream/gesture session is not inventable without native stream residual.
 * Product residual:
 *   - installAndLaunch on darwin ios: xcrun simctl boot/install/launch when tools present
 *   - attach without live stream → throw (no invent AmA streamUrl)
 *   - gesture without attachment → throw
 *   - android paths: throw residual unavailable (no invent emulator session)
 *
 * data-official-source: app.asar Ysr / Usr / AmA / Fle iosSimulator capability
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SimulatorInstallRequest = {
  udid: string;
  appPath: string;
  bundleId?: string;
  kind?: string;
};

export type SimulatorAttachment = {
  kind?: string;
  udid: string;
  deviceName: string;
  streamUrl: string;
  pointWidth: number;
  pointHeight: number;
  streamMode?: string;
};

/** Official Ysr residual. */
export function parseSimulatorInstallRequest(
  raw: unknown,
): SimulatorInstallRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.udid !== "string" || o.udid.length === 0) return null;
  if (typeof o.appPath !== "string" || o.appPath.length === 0) return null;
  if (o.bundleId !== undefined && typeof o.bundleId !== "string") return null;
  if (o.kind !== undefined && typeof o.kind !== "string") return null;
  return {
    udid: o.udid,
    appPath: o.appPath,
    bundleId: typeof o.bundleId === "string" ? o.bundleId : undefined,
    kind: typeof o.kind === "string" ? o.kind : undefined,
  };
}

async function runSimctl(
  args: string[],
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("xcrun", ["simctl", ...args], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * Official-ish installAndLaunch residual for iOS Simulator.
 * void success when boot+install(+optional launch) complete.
 * Throws on missing platform/tools/app — never invents attachment stream.
 */
export async function installAndLaunchIosSimulator(
  req: SimulatorInstallRequest,
  deps: {
    platform?: NodeJS.Platform;
    pathExists?: (p: string) => Promise<boolean>;
    simctl?: typeof runSimctl;
  } = {},
): Promise<void> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error(
      "Simulator installAndLaunch residual unavailable (unsupported_platform)",
    );
  }
  const kind = (req.kind ?? "ios").toLowerCase();
  if (kind === "android" || req.udid.startsWith("android-") || req.udid.startsWith("adb:")) {
    throw new Error(
      "Simulator installAndLaunch residual unavailable (android emulator session not productized)",
    );
  }

  const exists =
    deps.pathExists ??
    (async (p: string) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    });
  if (!(await exists(req.appPath))) {
    throw new Error(`Simulator appPath not found: ${req.appPath}`);
  }

  const simctl = deps.simctl ?? runSimctl;
  // boot may fail if already booted — ignore "Unable to boot device in current state: Booted"
  try {
    await simctl(["boot", req.udid], 120_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Booted|current state/i.test(msg)) {
      throw new Error(`simctl boot failed: ${msg}`);
    }
  }

  try {
    await simctl(["install", req.udid, req.appPath], 180_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`simctl install failed: ${msg}`);
  }

  if (req.bundleId) {
    try {
      await simctl(["launch", req.udid, req.bundleId], 60_000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`simctl launch failed: ${msg}`);
    }
  }
}

/** Official attach request residual (udid / deviceName / kind optional bag). */
export type SimulatorAttachRequest = {
  udid?: string;
  deviceName?: string;
  kind?: string;
};

/**
 * Parse attach args residual. Official may pass udid string or bag.
 * Returns null when completely empty — still honest (no invent).
 */
export function parseSimulatorAttachRequest(
  raw: unknown,
): SimulatorAttachRequest | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") {
    const udid = raw.trim();
    return udid ? { udid } : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const udid = typeof o.udid === "string" ? o.udid.trim() : "";
  const deviceName =
    typeof o.deviceName === "string"
      ? o.deviceName.trim()
      : typeof o.name === "string"
        ? o.name.trim()
        : "";
  const kind = typeof o.kind === "string" ? o.kind.trim() : "";
  if (!udid && !deviceName && !kind) return null;
  const out: SimulatorAttachRequest = {};
  if (udid) out.udid = udid;
  if (deviceName) out.deviceName = deviceName;
  if (kind) out.kind = kind;
  return out;
}

/**
 * Official attach residual without stream pipeline:
 * cannot invent streamUrl/point dimensions — throw honest unavailable.
 * Full MessagePort/stream body is separate surface.
 *
 * Accepts optional parsed request for diagnostics only — never fabricates AmA.
 */
export function attachSimulatorSessionResidual(
  req?: SimulatorAttachRequest,
): never {
  const detail = req?.udid
    ? ` udid=${req.udid}`
    : req?.deviceName
      ? ` deviceName=${req.deviceName}`
      : "";
  throw new Error(
    `Simulator attach residual unavailable (no live stream session)${detail}`,
  );
}

export function gestureSimulatorResidual(): never {
  throw new Error(
    "Simulator gesture residual unavailable (no attached sim session)",
  );
}

/**
 * Build AmA bag only from real stream residual fields.
 * Returns null when any required field missing — never invent streamUrl/size.
 */
export function buildSimulatorAttachmentAmA(
  raw: unknown,
): SimulatorAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.udid !== "string" || !o.udid) return null;
  if (typeof o.deviceName !== "string" || !o.deviceName) return null;
  if (typeof o.streamUrl !== "string" || !o.streamUrl) return null;
  if (typeof o.pointWidth !== "number" || !Number.isFinite(o.pointWidth)) {
    return null;
  }
  if (typeof o.pointHeight !== "number" || !Number.isFinite(o.pointHeight)) {
    return null;
  }
  if (o.pointWidth <= 0 || o.pointHeight <= 0) return null;
  // Require real stream scheme residual — no invent http invent frames.
  if (
    !/^wss?:\/\//i.test(o.streamUrl) &&
    !/^https?:\/\//i.test(o.streamUrl) &&
    !/^rfb:\/\//i.test(o.streamUrl)
  ) {
    return null;
  }
  return {
    kind: typeof o.kind === "string" ? o.kind : undefined,
    udid: o.udid,
    deviceName: o.deviceName,
    streamUrl: o.streamUrl,
    pointWidth: o.pointWidth,
    pointHeight: o.pointHeight,
    streamMode: typeof o.streamMode === "string" ? o.streamMode : undefined,
  };
}
