import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  CoworkFileSystemWatcher,
  shouldIgnoreCoworkWatchedFileName,
} from "./coworkFileSystemWatcher";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
});

it("ignores official EAA file names", () => {
  expect(shouldIgnoreCoworkWatchedFileName(".hidden")).toBe(true);
  expect(shouldIgnoreCoworkWatchedFileName("~$lock.docx")).toBe(true);
  expect(shouldIgnoreCoworkWatchedFileName("~foo.tmp")).toBe(true);
  expect(shouldIgnoreCoworkWatchedFileName(".DS_Store")).toBe(true);
  expect(shouldIgnoreCoworkWatchedFileName("notes.txt")).toBe(false);
});

it("emits fs_file_created for new host files and fs_file_deleted on remove", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cowork-fs-watch-"));
  temps.push(dir);
  const watcher = new CoworkFileSystemWatcher();
  const events: Array<{ type: string; fileName: string }> = [];
  watcher.on("fsEvent", (event) => {
    events.push({ fileName: event.fileName, type: event.type });
  });

  watcher.startWatching("local_session_1", dir);
  // Seed existing file — must not fire create for pre-existing.
  writeFileSync(join(dir, "seeded.txt"), "seed");
  // Restart so seed is known
  watcher.stopWatching("local_session_1");
  watcher.startWatching("local_session_1", dir);

  writeFileSync(join(dir, "fresh.txt"), "hello");
  await vi.waitFor(() => {
    expect(events.some((e) => e.type === "fs_file_created" && e.fileName === "fresh.txt")).toBe(
      true,
    );
  }, { timeout: 2000 });

  unlinkSync(join(dir, "fresh.txt"));
  await vi.waitFor(() => {
    expect(events.some((e) => e.type === "fs_file_deleted" && e.fileName === "fresh.txt")).toBe(
      true,
    );
  }, { timeout: 2000 });

  watcher.dispose();
});

it("debounces modified events after create-echo grace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cowork-fs-mod-"));
  temps.push(dir);
  writeFileSync(join(dir, "a.txt"), "v1");
  const watcher = new CoworkFileSystemWatcher();
  const events: string[] = [];
  watcher.on("fsEvent", (event) => {
    events.push(event.type);
  });
  watcher.startWatching("s1", dir);

  writeFileSync(join(dir, "a.txt"), "v2");
  await vi.waitFor(() => {
    expect(events).toContain("fs_file_modified");
  }, { timeout: 2000 });

  watcher.dispose();
});
