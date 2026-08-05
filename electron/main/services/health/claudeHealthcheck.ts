/**
 * Official ocr residual (app.asar):
 *
 *   const ncr = "/healthcheck";
 *   async function ocr() {
 *     try {
 *       const A = new URL(ncr, or()).toString();
 *       const t = await gA.net.fetch(A, { headers: {} });
 *       return t.ok ? (await t.json()).status : "unhealthy";
 *     } catch {
 *       return "unhealthy";
 *     }
 *   }
 *   isClaudeCurrentlyHealthy() {
 *     return n.isDestroyed() ? false : (await ocr()) === "healthy";
 *   }
 *
 * or() = main window URL origin (app://localhost). Product protocol serves
 * /healthcheck via custom3pApi as { status: "healthy", timestamp }.
 *
 * data-official-source: app.asar index.js ocr / isClaudeCurrentlyHealthy
 */

import { net } from "electron";
import { APP_ORIGIN } from "../../protocol/constants";

export type HealthcheckStatus = "healthy" | "unhealthy" | string;

export async function fetchClaudeHealthcheckStatus(
  origin: string = APP_ORIGIN,
): Promise<HealthcheckStatus> {
  try {
    const url = new URL("/healthcheck", origin.endsWith("/") ? origin : `${origin}/`).toString();
    const response = await net.fetch(url, { headers: {} });
    if (!response.ok) return "unhealthy";
    const body = (await response.json()) as { status?: unknown };
    return typeof body.status === "string" ? body.status : "unhealthy";
  } catch {
    return "unhealthy";
  }
}

export async function isClaudeCurrentlyHealthyResidual(
  options: {
    destroyed?: boolean;
    origin?: string;
    fetchStatus?: () => Promise<HealthcheckStatus>;
  } = {},
): Promise<boolean> {
  if (options.destroyed) return false;
  const status = options.fetchStatus
    ? await options.fetchStatus()
    : await fetchClaudeHealthcheckStatus(options.origin);
  return status === "healthy";
}
