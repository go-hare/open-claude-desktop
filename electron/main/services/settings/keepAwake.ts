/**
 * Desktop keep-awake for official AppPreferences.keepAwakeEnabled (hYt).
 * Uses Electron powerSaveBlocker to prevent app suspension while enabled.
 */
import { powerSaveBlocker } from "electron";

let blockerId: number | null = null;

export function isKeepAwakeActive(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId);
}

export function applyKeepAwakeEnabled(enabled: boolean): boolean {
  if (enabled) {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
      return true;
    }
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
    return powerSaveBlocker.isStarted(blockerId);
  }

  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  blockerId = null;
  return true;
}

export function syncKeepAwakeFromPreferences(preferences: Record<string, unknown>): void {
  applyKeepAwakeEnabled(preferences.keepAwakeEnabled === true);
}
