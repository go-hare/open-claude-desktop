import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadOrCreateCustom3pInstallId } from "./custom3pInstallIdentity";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

it("persists the synthetic 3P account identity across main-process restarts", () => {
  const userDataPath = temporaryDirectory();
  const first = loadOrCreateCustom3pInstallId({
    createUuid: () => "11111111-1111-4111-8111-111111111111",
    userDataPath,
  });
  const second = loadOrCreateCustom3pInstallId({
    createUuid: () => "22222222-2222-4222-8222-222222222222",
    userDataPath,
  });

  expect(first).toBe("11111111-1111-4111-8111-111111111111");
  expect(second).toBe(first);
});

it("adopts the most recently used legacy Cowork account directory", () => {
  const userDataPath = temporaryDirectory();
  const older = "33333333-3333-4333-8333-333333333333";
  const newer = "44444444-4444-4444-8444-444444444444";
  const empty = "77777777-7777-4777-8777-777777777777";
  createLegacyAccount(userDataPath, older, 1_000);
  createLegacyAccount(userDataPath, newer, 2_000);
  createEmptyLegacyAccount(userDataPath, empty, 3_000);

  const installId = loadOrCreateCustom3pInstallId({
    createUuid: () => "55555555-5555-4555-8555-555555555555",
    userDataPath,
  });

  expect(installId).toBe(newer);
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "custom3p-install-id-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createLegacyAccount(userDataPath: string, accountUuid: string, modifiedAt: number): void {
  const directory = path.join(
    userDataPath,
    "local-agent-mode-sessions",
    accountUuid,
    "00000000-0000-4000-8000-000000000001",
  );
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "local_session.json"), "{}");
  const date = new Date(modifiedAt);
  fs.utimesSync(path.dirname(directory), date, date);
}

function createEmptyLegacyAccount(
  userDataPath: string,
  accountUuid: string,
  modifiedAt: number,
): void {
  const directory = path.join(userDataPath, "local-agent-mode-sessions", accountUuid);
  fs.mkdirSync(path.join(directory, "00000000-0000-4000-8000-000000000001"), {
    recursive: true,
  });
  const date = new Date(modifiedAt);
  fs.utimesSync(directory, date, date);
}
