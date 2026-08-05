/**
 * Official Launch.deployPreview / unpublishDeploy residual (app.asar E9 Nest gate).
 *
 * Non-Nest builds (product default):
 *   deployPreview(serverId, appName) →
 *     emit deployEvent(serverId, { type:"failed", error:"Deploy is only available in Nest builds." })
 *     return false
 *   unpublishDeploy(appName) →
 *     return "Unpublish is only available in Nest builds."
 *
 * Never invents local deploy success / orbit row on non-Nest path.
 *
 * data-official-source: app.asar deployPreview:async / unpublishDeploy:async / E9() empty Nest
 */

export const NEST_DEPLOY_UNAVAILABLE =
  "Deploy is only available in Nest builds.";
export const NEST_UNPUBLISH_UNAVAILABLE =
  "Unpublish is only available in Nest builds.";

export type LaunchDeployEvent =
  | { type: "failed"; error: string }
  | { type: string; [key: string]: unknown };

/**
 * Official non-Nest deployPreview residual.
 * Returns false after emitting failed deployEvent (caller supplies emitter).
 */
export function deployPreviewNestUnavailableResidual(
  serverId: string,
  emitDeployEvent: (serverId: string, event: LaunchDeployEvent) => void,
): false {
  emitDeployEvent(serverId, {
    type: "failed",
    error: NEST_DEPLOY_UNAVAILABLE,
  });
  return false;
}

/** Official non-Nest unpublishDeploy residual — error string (not null). */
export function unpublishDeployNestUnavailableResidual(): string {
  return NEST_UNPUBLISH_UNAVAILABLE;
}
