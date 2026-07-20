import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createManagerHarness,
  createTestManager,
} from "./coworkSessionTestUtils";

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

it("starts FileSystemWatcher and emits fs_file_created into session + events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cowork-mgr-fs-"));
  temps.push(dir);
  const harness = createManagerHarness();
  harness.persistence.sessionStorageDir = dir;
  const manager = createTestManager(harness);

  await manager.start({
    message: "hello",
    messageUuid: "m1",
    userSelectedFolders: [dir],
  });

  writeFileSync(join(dir, "from-agent.txt"), "content");
  await vi.waitFor(() => {
    expect(
      harness.events.some(
        (event) =>
          event.type === "fs_file_created" &&
          "fsFile" in event &&
          event.fsFile.fileName === "from-agent.txt",
      ),
    ).toBe(true);
  }, { timeout: 2500 });

  const session = manager.getSession("local_session_1");
  expect(session?.fsDetectedFiles?.some((f) => f.fileName === "from-agent.txt")).toBe(true);

  await manager.stop("local_session_1");
});
