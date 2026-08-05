import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCredentialHelperRunResult,
  getCredentialHelperLastRunResidual,
  isCredentialHelperAbsolutePath,
  isCredentialHelperRunResult,
  parseCredentialHelperStdout,
  resetCredentialHelperLastRunForTests,
  runCredentialHelperResidual,
} from "./credentialHelperResidual";

afterEach(() => {
  resetCredentialHelperLastRunForTests();
});

describe("credentialHelperResidual", () => {
  it("Gre validator rejects invent ok bag", () => {
    expect(
      isCredentialHelperRunResult({
        ok: true,
        ranAt: new Date().toISOString(),
        input: {},
      }),
    ).toBe(false);
    expect(isCredentialHelperAbsolutePath("relative/helper.sh")).toBe(false);
    expect(isCredentialHelperAbsolutePath("/tmp/helper.sh")).toBe(true);
  });

  it("f6t residual rejects UNC / double-slash before normalize collapse", () => {
    // POSIX path.normalize("//evil/x") → "/evil/x" — must still be bad-path.
    expect(isCredentialHelperAbsolutePath("//evil/share/helper.sh")).toBe(false);
    expect(isCredentialHelperAbsolutePath("\\\\server\\share\\helper.sh")).toBe(
      false,
    );
    expect(isCredentialHelperAbsolutePath("//tmp/helper.sh")).toBe(false);
  });

  it("bad-path returns failed Gre shape (no invent ok)", async () => {
    const result = await runCredentialHelperResidual("not/absolute");
    expect(result.ok).toBe(false);
    expect(result.state).toBe("failed");
    expect(result.reason).toBe("bad-path");
    expect(result.helperPath).toBe("not/absolute");
    expect(isCredentialHelperRunResult(result)).toBe(true);
    expect(getCredentialHelperLastRunResidual()).toEqual(result);
  });

  it("UNC path returns bad-path (not spawn-failed invent)", async () => {
    const result = await runCredentialHelperResidual("//evil/share/helper.sh");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-path");
    expect(result.state).toBe("failed");
    expect(isCredentialHelperRunResult(result)).toBe(true);
  });

  it("parses bare-token and json stdout", () => {
    expect(parseCredentialHelperStdout("sk-test-token")).toEqual({
      token: "sk-test-token",
      isJson: false,
    });
    expect(
      parseCredentialHelperStdout('{"token":"abc","headers":{"X":"1"}}'),
    ).toMatchObject({
      token: "abc",
      isJson: true,
      headers: { X: "1" },
    });
    expect(parseCredentialHelperStdout("line1\nline2")).toBeNull();
  });

  it("runs absolute helper script and records last run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cred-helper-"));
    const script = path.join(dir, "helper.sh");
    await fs.writeFile(script, "#!/bin/sh\necho 'tok-from-helper'\n", "utf8");
    await fs.chmod(script, 0o755);

    const result = await runCredentialHelperResidual(script);
    expect(result.ok).toBe(true);
    expect(result.state).toBe("success");
    expect(result.outputFormat).toBe("bare-token");
    expect(result.helperPath).toBe(script);
    expect(result.stdoutBytes).toBeGreaterThan(0);
    expect(isCredentialHelperRunResult(result)).toBe(true);
    expect(getCredentialHelperLastRunResidual()?.ok).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("G0A failed empty reason copy", () => {
    const bag = buildCredentialHelperRunResult(
      "/x",
      {
        ok: false,
        reason: "empty",
        elapsedMs: 1,
        exitCode: 0,
        stdoutBytes: 0,
        stderr: "",
        stdout: "",
      },
      null,
    );
    expect(bag.ok).toBe(false);
    expect(bag.reason).toBe("empty");
    expect(bag.parseErrorReason).toMatch(/printed nothing/);
  });
});
