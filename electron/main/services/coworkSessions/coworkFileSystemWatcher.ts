import { EventEmitter } from "node:events";
import {
  existsSync,
  readdirSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { basename, join } from "node:path";

/** Official onA (app.asar): junk names that should never surface as activity. */
export function isCoworkIgnoredFsName(fileName: string): boolean {
  const name = basename(fileName);
  return (
    name === ".DS_Store" ||
    name === "__MACOSX" ||
    fileName.startsWith("__MACOSX/") ||
    name === "Thumbs.db" ||
    name === "desktop.ini"
  );
}

/**
 * Official EAA (app.asar): skip dotfiles, Office lock files (~$), temp (~*.tmp), junk.
 * Applied to the basename emitted by fs.watch.
 */
export function shouldIgnoreCoworkWatchedFileName(fileName: string): boolean {
  return (
    fileName.startsWith(".") ||
    fileName.startsWith("~$") ||
    (fileName.startsWith("~") && fileName.endsWith(".tmp")) ||
    isCoworkIgnoredFsName(fileName)
  );
}

export type CoworkFsWatchEvent = {
  fileName: string;
  hostPath: string;
  sessionId: string;
  timestamp: number;
  type: "fs_file_created" | "fs_file_modified" | "fs_file_deleted";
};

type CoworkFileSystemWatcherEvents = {
  fsEvent: [CoworkFsWatchEvent];
};

/**
 * Official FileSystemWatcher (`_v` / `ANA` in app.asar):
 * - non-recursive `fs.watch` per directory
 * - seed known files from readdir (skip ignored)
 * - create immediate, modify debounced 150ms, create-echo grace 300ms
 * - emit `fsEvent` with flat sessionId/hostPath/fileName/timestamp
 */
export class CoworkFileSystemWatcher extends EventEmitter<CoworkFileSystemWatcherEvents> {
  static readonly MODIFY_DEBOUNCE_MS = 150;
  static readonly CREATE_ECHO_GRACE_MS = 300;

  private readonly watchers = new Map<string, FSWatcher>();
  private readonly knownFiles = new Map<string, Set<string>>();
  private readonly sessionWatcherKeys = new Map<string, Set<string>>();
  private readonly modifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recentCreateAt = new Map<string, number>();

  private clearModifyTimer(key: string): void {
    const timer = this.modifyTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.modifyTimers.delete(key);
    }
  }

  private watcherKey(sessionId: string, dir: string): string {
    return `${sessionId}:${dir}`;
  }

  startWatching(sessionId: string, dir: string): void {
    const key = this.watcherKey(sessionId, dir);
    if (this.watchers.has(key)) return;
    if (!existsSync(dir)) return;

    const known = new Set<string>();
    try {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        try {
          if (!statSync(full).isFile()) continue;
          if (shouldIgnoreCoworkWatchedFileName(name)) continue;
          known.add(name);
        } catch {
          // skip unreadable entries
        }
      }
    } catch {
      return;
    }
    this.knownFiles.set(key, known);

    try {
      const watcher = watch(dir, { recursive: false }, (eventType, fileName) => {
        void eventType;
        if (!fileName || shouldIgnoreCoworkWatchedFileName(fileName)) return;
        const hostPath = join(dir, fileName);
        const fileKey = `${key}:${fileName}`;
        const knownForDir = this.knownFiles.get(key);
        if (!knownForDir) return;

        const exists = existsSync(hostPath);
        let isFile = false;
        if (exists) {
          try {
            isFile = statSync(hostPath).isFile();
          } catch {
            isFile = false;
          }
        }

        if (exists && isFile) {
          if (knownForDir.has(fileName)) {
            const createdAt = this.recentCreateAt.get(fileKey);
            if (
              createdAt !== undefined &&
              Date.now() - createdAt < CoworkFileSystemWatcher.CREATE_ECHO_GRACE_MS
            ) {
              return;
            }
            this.clearModifyTimer(fileKey);
            this.modifyTimers.set(
              fileKey,
              setTimeout(() => {
                this.modifyTimers.delete(fileKey);
                this.emit("fsEvent", {
                  fileName,
                  hostPath,
                  sessionId,
                  timestamp: Date.now(),
                  type: "fs_file_modified",
                });
              }, CoworkFileSystemWatcher.MODIFY_DEBOUNCE_MS),
            );
          } else {
            knownForDir.add(fileName);
            this.clearModifyTimer(fileKey);
            this.recentCreateAt.set(fileKey, Date.now());
            this.emit("fsEvent", {
              fileName,
              hostPath,
              sessionId,
              timestamp: Date.now(),
              type: "fs_file_created",
            });
          }
          return;
        }

        if (knownForDir.has(fileName)) {
          knownForDir.delete(fileName);
          this.clearModifyTimer(fileKey);
          this.recentCreateAt.delete(fileKey);
          this.emit("fsEvent", {
            fileName,
            hostPath,
            sessionId,
            timestamp: Date.now(),
            type: "fs_file_deleted",
          });
        }
      });
      watcher.on("error", () => {
        // Official logs and keeps map entry; close path via stopWatching.
      });
      this.watchers.set(key, watcher);
      let keys = this.sessionWatcherKeys.get(sessionId);
      if (!keys) {
        keys = new Set();
        this.sessionWatcherKeys.set(sessionId, keys);
      }
      keys.add(key);
    } catch {
      this.knownFiles.delete(key);
    }
  }

  stopWatching(sessionId: string): void {
    const keys = this.sessionWatcherKeys.get(sessionId);
    if (!keys) return;
    for (const key of keys) {
      const watcher = this.watchers.get(key);
      watcher?.close();
      this.watchers.delete(key);
      this.knownFiles.delete(key);
      const prefix = `${key}:`;
      for (const timerKey of [...this.modifyTimers.keys()]) {
        if (timerKey.startsWith(prefix)) this.clearModifyTimer(timerKey);
      }
      for (const createKey of [...this.recentCreateAt.keys()]) {
        if (createKey.startsWith(prefix)) this.recentCreateAt.delete(createKey);
      }
    }
    this.sessionWatcherKeys.delete(sessionId);
  }

  isWatching(sessionId: string): boolean {
    return this.sessionWatcherKeys.has(sessionId);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    for (const timer of this.modifyTimers.values()) clearTimeout(timer);
    this.modifyTimers.clear();
    this.recentCreateAt.clear();
    this.watchers.clear();
    this.knownFiles.clear();
    this.sessionWatcherKeys.clear();
  }
}
