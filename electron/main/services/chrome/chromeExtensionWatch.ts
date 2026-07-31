/**
 * Official Jir residual: watch browser profile roots for Extensions/{id} changes,
 * debounce → vrt() native host re-sync.
 */

import fs from "node:fs";
import type { FSWatcher } from "node:fs";
import { app } from "electron";
import {
  browserProfileRootsForExtensionDetect,
  CHROME_EXTENSION_IDS_DETECT,
  syncChromeNativeHost,
} from "./chromeNativeHost";

const watchers: FSWatcher[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;
let beforeQuitHooked = false;

export function startChromeExtensionInstallWatcher(options?: {
  userDataPath?: string;
  log?: (msg: string) => void;
}): void {
  if (watchers.length > 0) return;
  const log = options?.log ?? ((m) => console.info(m));
  const userDataPath =
    options?.userDataPath ??
    (typeof app?.getPath === "function" ? app.getPath("userData") : undefined);

  for (const root of browserProfileRootsForExtensionDetect()) {
    try {
      const watcher = fs.watch(root.path, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const normalized = String(filename).split("\\").join("/");
        if (
          !CHROME_EXTENSION_IDS_DETECT.some((id) =>
            normalized.includes(`/Extensions/${id}`),
          )
        ) {
          return;
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void syncChromeNativeHost({ userDataPath, log });
        }, DEBOUNCE_MS);
      });
      watcher.on("error", (error) => {
        log(
          `[Chrome Extension MCP] Watcher error for ${root.name}: ${String(error)}`,
        );
      });
      watchers.push(watcher);
      log(
        `[Chrome Extension MCP] Watching ${root.name} for extension changes`,
      );
    } catch (error) {
      log(
        `[Chrome Extension MCP] Not watching ${root.name} for extension changes: ${String(error)}`,
      );
    }
  }

  if (!beforeQuitHooked && typeof app?.on === "function") {
    beforeQuitHooked = true;
    app.on("before-quit", () => {
      stopChromeExtensionInstallWatcher();
    });
  }
}

export function stopChromeExtensionInstallWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const watcher of watchers.splice(0)) {
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  }
}
