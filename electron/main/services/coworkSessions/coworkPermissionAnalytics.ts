/**
 * Official LocalAgentModeSessionManager permission analytics (app.asar je):
 *   lam_tool_permission_requested
 *   lam_tool_permission_stalled   (300s while pending)
 *   lam_tool_permission_responded
 *
 * Full product telemetry sink is residual; default logs structured events and
 * accepts an injectable sink for tests / future desktop analytics wire.
 */

export type CoworkPermissionAnalyticsProps = {
  decision?: string;
  latency_ms?: number;
  permission_mode: string | null;
  request_id: string;
  seconds_waiting?: number;
  session_id: string;
  session_type: "cowork";
  tool_name: string;
  user_message_uuid: string | null;
};

export type CoworkPermissionAnalyticsName =
  | "lam_tool_permission_requested"
  | "lam_tool_permission_stalled"
  | "lam_tool_permission_responded";

export type CoworkPermissionAnalyticsEvent = {
  name: CoworkPermissionAnalyticsName;
  props: CoworkPermissionAnalyticsProps;
};

export type CoworkPermissionAnalyticsSink = (
  event: CoworkPermissionAnalyticsEvent,
) => void;

const defaultSink: CoworkPermissionAnalyticsSink = (event) => {
  // Structured log only — not a substitute for full product analytics.
  console.info("[coworkPermissionAnalytics] %s %j", event.name, event.props);
};

let activeSink: CoworkPermissionAnalyticsSink = defaultSink;

export function setCoworkPermissionAnalyticsSink(
  sink: CoworkPermissionAnalyticsSink | null,
): void {
  activeSink = sink ?? defaultSink;
}

export function trackCoworkPermissionAnalytics(
  name: CoworkPermissionAnalyticsName,
  props: CoworkPermissionAnalyticsProps,
): void {
  try {
    activeSink({ name, props });
  } catch (error) {
    console.warn("[coworkPermissionAnalytics] sink failed: %o", error);
  }
}

export function clearCoworkPermissionAnalyticsForTests(): void {
  activeSink = defaultSink;
}
