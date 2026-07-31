import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  officialExtraBinDirGlobs,
  resolveCommandOnAllPaths,
  resolveOfficialAllPaths,
} from "./localSessionCommandPath";

describe("localSessionCommandPath official residual", () => {
  it("officialExtraBinDirGlobs includes Homebrew bin on darwin", () => {
    const dirs = officialExtraBinDirGlobs("/Users/me", "darwin");
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
  });

  it("resolveOfficialAllPaths merges env PATH with homebrew residual", async () => {
    const paths = await resolveOfficialAllPaths(
      { PATH: "/usr/bin:/bin" },
      "darwin",
      os.homedir(),
    );
    expect(paths).toContain("/usr/bin");
    // May or may not exist on CI; if homebrew present should include it.
    if (
      await fs
        .access("/opt/homebrew/bin")
        .then(() => true)
        .catch(() => false)
    ) {
      expect(paths).toContain("/opt/homebrew/bin");
    }
  });

  it("resolveCommandOnAllPaths finds gh under /opt/homebrew/bin when present", async () => {
    const gh = "/opt/homebrew/bin/gh";
    const present = await fs
      .access(gh)
      .then(() => true)
      .catch(() => false);
    if (!present) return;
    const resolved = await resolveCommandOnAllPaths("gh", [
      "/opt/homebrew/bin",
      "/usr/bin",
    ]);
    expect(resolved).toBe(gh);
  });

  it("resolveCommandOnAllPaths returns null when missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cmdpath-"));
    const resolved = await resolveCommandOnAllPaths("definitely-not-a-binary-xyz", [tmp]);
    expect(resolved).toBeNull();
  });
});
