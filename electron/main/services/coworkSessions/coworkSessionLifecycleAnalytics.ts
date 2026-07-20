/**
 * Official LocalAgentModeSessionManager stop/archive je analytics (app.asar):
 *   lam_session_stopped  — stopSession when (Wl(session)||query) && !force
 *   lam_session_archived — archiveSession after stopSession(A, true)
 *
 * Full product telemetry sink is residual; default logs structured events and
 * accepts an injectable sink (same pattern as coworkPermissionAnalytics).
 *
 * Official vm_instance_id = Wn() process UUID (Z5). Product pure singleton —
 * not a full VM product invent.
 */

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

export type CoworkSessionLifecycleAnalyticsName =
  | "lam_session_stopped"
  | "lam_session_archived";

export type CoworkSessionLifecycleAnalyticsProps = {
  session_id: string;
  cli_session_id: string | null;
  vm_instance_id: string;
  total_turns: number;
  session_duration_ms: number;
  transcript_size_bytes: number | undefined;
  /** Official stop payload only — archive omits session_type. */
  session_type?: string | null | undefined;
};

export type CoworkSessionLifecycleAnalyticsEvent = {
  name: CoworkSessionLifecycleAnalyticsName;
  props: CoworkSessionLifecycleAnalyticsProps;
};

export type CoworkSessionLifecycleAnalyticsSink = (
  event: CoworkSessionLifecycleAnalyticsEvent,
) => void;

const defaultSink: CoworkSessionLifecycleAnalyticsSink = (event) => {
  console.info(
    "[coworkSessionLifecycleAnalytics] %s %j",
    event.name,
    event.props,
  );
};

let activeSink: CoworkSessionLifecycleAnalyticsSink = defaultSink;

/** Official Z5 / Wn() process-level vm instance id. */
let cachedVmInstanceId: string | null = null;

export function setCoworkSessionLifecycleAnalyticsSink(
  sink: CoworkSessionLifecycleAnalyticsSink | null,
): void {
  activeSink = sink ?? defaultSink;
}

export function clearCoworkSessionLifecycleAnalyticsForTests(): void {
  activeSink = defaultSink;
  cachedVmInstanceId = null;
}

/**
 * Official Wn(): return Z5 || (Z5 = randomUUID()).
 * Pure residual — not dual-exec / real VM product.
 */
export function getCoworkVmInstanceId(): string {
  if (!cachedVmInstanceId) cachedVmInstanceId = randomUUID();
  return cachedVmInstanceId;
}

/** Test-only: reset Wn cache (official MTi residual). */
export function resetCoworkVmInstanceIdForTests(): void {
  cachedVmInstanceId = null;
}

export function trackCoworkSessionLifecycleAnalytics(
  name: CoworkSessionLifecycleAnalyticsName,
  props: CoworkSessionLifecycleAnalyticsProps,
): void {
  try {
    activeSink({ name, props });
  } catch (error) {
    console.warn("[coworkSessionLifecycleAnalytics] sink failed: %o", error);
  }
}

/**
 * Official Wl(session): lifecycleState !== "idle" && !== "archived".
 * Used as stopSession track gate left side: (Wl || query) && !force.
 */
export function isCoworkSessionLifecycleActive(
  lifecycleState: string | null | undefined,
): boolean {
  return lifecycleState !== "idle" && lifecycleState !== "archived";
}

/**
 * Official stopSession track gate: (Wl(session) || session.query) && !force.
 * Product: wasActive = isCoworkSessionLifecycleActive(pre-stop state) || hadQuery.
 * `wasRunning` kept as alias for active lifecycle (not only "running").
 */
export function shouldTrackCoworkSessionStopped(input: {
  force?: boolean;
  hadQuery: boolean;
  /** Pre-stop lifecycleState, or true when Wl-active. */
  wasRunning: boolean;
  lifecycleState?: string | null;
}): boolean {
  if (input.force) return false;
  const wl =
    input.lifecycleState !== undefined
      ? isCoworkSessionLifecycleActive(input.lifecycleState)
      : input.wasRunning;
  return input.hadQuery || wl;
}

export function buildCoworkSessionStoppedProps(input: {
  sessionId: string;
  cliSessionId?: string | null;
  sessionType?: string | null;
  totalTurns: number;
  sessionDurationMs: number;
  transcriptSizeBytes?: number;
  vmInstanceId?: string;
}): CoworkSessionLifecycleAnalyticsProps {
  return {
    session_id: input.sessionId,
    cli_session_id: input.cliSessionId ?? null,
    vm_instance_id: input.vmInstanceId ?? getCoworkVmInstanceId(),
    session_type: input.sessionType ?? null,
    total_turns: input.totalTurns,
    session_duration_ms: input.sessionDurationMs,
    transcript_size_bytes: input.transcriptSizeBytes,
  };
}

export function buildCoworkSessionArchivedProps(input: {
  sessionId: string;
  cliSessionId?: string | null;
  totalTurns: number;
  sessionDurationMs: number;
  transcriptSizeBytes?: number;
  vmInstanceId?: string;
}): CoworkSessionLifecycleAnalyticsProps {
  // Official archive payload has no session_type field.
  return {
    session_id: input.sessionId,
    cli_session_id: input.cliSessionId ?? null,
    vm_instance_id: input.vmInstanceId ?? getCoworkVmInstanceId(),
    total_turns: input.totalTurns,
    session_duration_ms: input.sessionDurationMs,
    transcript_size_bytes: input.transcriptSizeBytes,
  };
}

/**
 * Official getTranscriptSizeBytes / resolveTranscriptFilePath residual.
 * Best-effort: if transcriptFilePath set → lstat size; else
 * storage/.claude/projects/<project>/<cliSessionId>.jsonl first hit.
 * Missing → undefined (official catch returns void 0).
 */
export async function resolveCoworkTranscriptSizeBytes(
  session: Pick<
    CoworkSessionRuntimeState,
    "cliSessionId" | "sessionId"
  > & {
    transcriptFilePath?: string | null;
  },
  options?: {
    sessionStorageDir?: string | null;
    readdir?: (dir: string) => Promise<string[]>;
    lstatSize?: (path: string) => Promise<number | undefined>;
  },
): Promise<number | undefined> {
  const lstatSize =
    options?.lstatSize ??
    (async (path: string) => {
      try {
        const st = await lstat(path);
        return st.isFile() ? st.size : undefined;
      } catch {
        return undefined;
      }
    });

  if (session.transcriptFilePath) {
    return lstatSize(session.transcriptFilePath);
  }
  if (!session.cliSessionId) return undefined;
  const storage = options?.sessionStorageDir;
  if (!storage) return undefined;
  const projects = join(storage, ".claude", "projects");
  const readdir =
    options?.readdir ??
    (async (dir: string) => {
      const { readdir: fsReaddir } = await import("node:fs/promises");
      return fsReaddir(dir);
    });
  let entries: string[];
  try {
    entries = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const candidate = join(projects, entry, `${session.cliSessionId}.jsonl`);
    const size = await lstatSize(candidate);
    if (size !== undefined) return size;
  }
  return undefined;
}
