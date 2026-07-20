import path from "node:path";
import { expect, it } from "vitest";
import {
  coworkAccountStorageDir,
  coworkAgentMemoryDir,
  coworkRadarMemoryDir,
  coworkSpaceMemoryDir,
  resolveCoworkAutoMemoryDir,
} from "./coworkAutoMemoryPaths";

const userData = "/tmp/userData";
const accountDir = coworkAccountStorageDir(userData, "account-1", "org-1");

it("RB account storage matches local-agent-mode-sessions/account/org", () => {
  expect(accountDir).toBe(
    path.join(userData, "local-agent-mode-sessions", "account-1", "org-1"),
  );
});

it("ZrA resolves spaces/<spaceId>/memory under account root", () => {
  expect(coworkSpaceMemoryDir(accountDir, "space_abc")).toBe(
    path.join(accountDir, "spaces", "space_abc", "memory"),
  );
});

it("Use resolves agent/memory under account root", () => {
  expect(coworkAgentMemoryDir(accountDir)).toBe(
    path.join(accountDir, "agent", "memory"),
  );
});

it("GL resolves memory/memory under account root", () => {
  expect(coworkRadarMemoryDir(accountDir)).toBe(
    path.join(accountDir, "memory", "memory"),
  );
});

it("getAutoMemoryDir prefers spaceId over sessionType (official ZrA first)", () => {
  expect(
    resolveCoworkAutoMemoryDir(accountDir, {
      sessionType: "agent",
      spaceId: "space_1",
    }),
  ).toBe(path.join(accountDir, "spaces", "space_1", "memory"));
});

it("getAutoMemoryDir maps agent sessions to Use", () => {
  expect(
    resolveCoworkAutoMemoryDir(accountDir, { sessionType: "agent" }),
  ).toBe(path.join(accountDir, "agent", "memory"));
});

it("getAutoMemoryDir maps radar sessions to GL", () => {
  expect(
    resolveCoworkAutoMemoryDir(accountDir, { sessionType: "radar" }),
  ).toBe(path.join(accountDir, "memory", "memory"));
});

it("getAutoMemoryDir returns null for ordinary cowork without space", () => {
  expect(resolveCoworkAutoMemoryDir(accountDir, {})).toBeNull();
  expect(
    resolveCoworkAutoMemoryDir(accountDir, { sessionType: "scheduled" }),
  ).toBeNull();
});

it("memoryEnabled === false disables auto memory (official startSession gate)", () => {
  expect(
    resolveCoworkAutoMemoryDir(accountDir, {
      memoryEnabled: false,
      spaceId: "space_1",
    }),
  ).toBeNull();
  expect(
    resolveCoworkAutoMemoryDir(accountDir, {
      memoryEnabled: false,
      sessionType: "agent",
    }),
  ).toBeNull();
  // undefined / true keep resolution
  expect(
    resolveCoworkAutoMemoryDir(accountDir, {
      memoryEnabled: true,
      spaceId: "space_1",
    }),
  ).toBe(path.join(accountDir, "spaces", "space_1", "memory"));
});

it("getAutoMemoryDir returns null without account root", () => {
  expect(resolveCoworkAutoMemoryDir(null, { spaceId: "s" })).toBeNull();
  expect(resolveCoworkAutoMemoryDir(undefined, { sessionType: "agent" })).toBe(
    null,
  );
});

it("rejects unsafe spaceId path segments", () => {
  expect(
    resolveCoworkAutoMemoryDir(accountDir, { spaceId: "../escape" }),
  ).toBeNull();
  expect(
    resolveCoworkAutoMemoryDir(accountDir, { spaceId: "a/b" }),
  ).toBeNull();
});

it("Spaces.getAutoMemoryDir semantics: known space → ZrA; unknown → null gate", () => {
  // Official: this.spaces.has(A) ? ZrA(...) : null — has-check is caller-side.
  const known = resolveCoworkAutoMemoryDir(accountDir, {
    spaceId: "known_space",
  });
  expect(known).toBe(
    path.join(accountDir, "spaces", "known_space", "memory"),
  );
  // Without account root (identity missing) → null, matching product wire.
  expect(
    resolveCoworkAutoMemoryDir(null, { spaceId: "known_space" }),
  ).toBeNull();
});
