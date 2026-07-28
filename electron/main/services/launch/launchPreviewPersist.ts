/**
 * Official Launch Preview partition residual (app.asar AOi / ZHA / D5e / iOi):
 *
 *   ZHA(cwd) = md5(cwd).hex.slice(0, 12)
 *   AOi(workspaceKey, persist):
 *     persist && key → `persist:launch-preview-${key}`
 *     !persist && key → `launch-preview-${key}` (ephemeral)
 *     else → default partition
 *   D5e(..., workspaceKey, persist):
 *     if persist && workspaceKey:
 *       append workspaceKey to gi("launchPreviewPersistedWorkspaces")
 *   iOi() when launchPreviewPersistSession turns off:
 *     clear default + each persist:launch-preview-* partition data
 *     xn("launchPreviewPersistedWorkspaces", [])
 *   Rh.on("launchPreviewPersistSession", c => { if (!c) iOi() })
 *
 * Product: LocalLaunchManager still serves iframe URLs; partition create/clear
 * is the durable residual for when WebContentsView is attached. Do not invent
 * cookie/storage semantics beyond official clearData + list write.
 */

import { createHash } from "node:crypto";
import { session as electronSession } from "electron";

/** Official o9 default non-persist partition for preview without workspace key. */
export const LAUNCH_PREVIEW_DEFAULT_PARTITION = "persist:launch-preview-static";

const partitionSessions = new Map<string, Electron.Session>();

export function hashLaunchPreviewWorkspace(cwd: string): string {
  return createHash("md5").update(cwd).digest("hex").slice(0, 12);
}

/**
 * Official AOi residual — partition name for a preview workspace.
 * @param workspaceKey ZHA(cwd) or undefined
 * @param persist gi("launchPreviewPersistSession")
 */
export function launchPreviewPartitionName(
  workspaceKey: string | null | undefined,
  persist: boolean,
): string {
  if (workspaceKey && persist) return `persist:launch-preview-${workspaceKey}`;
  if (workspaceKey) return `launch-preview-${workspaceKey}`;
  return LAUNCH_PREVIEW_DEFAULT_PARTITION;
}

/**
 * Official AOi residual — get or create Session for partition; cache like FD Map.
 */
export function getLaunchPreviewSession(
  workspaceKey: string | null | undefined,
  persist: boolean,
): Electron.Session {
  const name = launchPreviewPartitionName(workspaceKey, persist);
  const cached = partitionSessions.get(name);
  if (cached) return cached;
  const sess = electronSession.fromPartition(name);
  // Official XFi: deny permission requests in preview partitions.
  try {
    sess.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
    sess.setPermissionCheckHandler(() => false);
  } catch {
    /* best-effort */
  }
  partitionSessions.set(name, sess);
  return sess;
}

export type LaunchPreviewPersistStore = {
  getPersistedWorkspaces: () => string[];
  setPersistedWorkspaces: (keys: string[]) => void;
};

/**
 * Official D5e list-append residual when persist is on and workspace key known.
 */
export function recordLaunchPreviewPersistedWorkspace(
  workspaceKey: string,
  store: LaunchPreviewPersistStore,
): void {
  if (!workspaceKey) return;
  const current = store.getPersistedWorkspaces();
  if (current.includes(workspaceKey)) return;
  store.setPersistedWorkspaces([...current, workspaceKey]);
}

/**
 * Official iOi residual — clear all launch-preview partition data + empty list.
 */
export async function clearLaunchPreviewPersistedSessions(
  store: LaunchPreviewPersistStore,
): Promise<void> {
  const keys = store.getPersistedWorkspaces();
  const names = new Set<string>([
    LAUNCH_PREVIEW_DEFAULT_PARTITION,
    ...keys.map((k) => `persist:launch-preview-${k}`),
  ]);
  for (const name of partitionSessions.keys()) {
    if (name.startsWith("persist:launch-preview-") || name.startsWith("launch-preview-")) {
      names.add(name);
    }
  }
  for (const name of names) {
    try {
      const sess = partitionSessions.get(name) ?? electronSession.fromPartition(name);
      await sess.clearData();
      partitionSessions.delete(name);
    } catch {
      /* best-effort clear */
    }
  }
  store.setPersistedWorkspaces([]);
}

/** Test helper — drop in-memory partition cache. */
export function resetLaunchPreviewPartitionCacheForTests(): void {
  partitionSessions.clear();
}
