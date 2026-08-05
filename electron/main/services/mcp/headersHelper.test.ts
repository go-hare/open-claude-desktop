import { describe, expect, it, beforeEach } from "vitest";
import {
  isLocalAbsoluteHelperPath,
  resolveHelperCommand,
  validateHelperHeaders,
  resetHeadersHelperCacheForTests,
} from "./headersHelper";

describe("headersHelper residual", () => {
  beforeEach(() => {
    resetHeadersHelperCacheForTests();
  });

  it("f6t accepts only absolute local paths", () => {
    expect(isLocalAbsoluteHelperPath("/usr/local/bin/helper")).toBe(true);
    expect(isLocalAbsoluteHelperPath("relative/helper")).toBe(false);
    expect(isLocalAbsoluteHelperPath("")).toBe(false);
    // Pre-normalize UNC reject (POSIX normalize("//x") → "/x" hole closed).
    expect(isLocalAbsoluteHelperPath("\\\\unc\\share\\helper")).toBe(false);
    expect(isLocalAbsoluteHelperPath("//unc/share/helper")).toBe(false);
    expect(isLocalAbsoluteHelperPath("//evil/share/helper.sh")).toBe(false);
  });

  it("p6t wraps win32 ps1/cmd", () => {
    const ps1 = resolveHelperCommand("C:\\\\tools\\\\h.ps1", "win32");
    expect(ps1.cmd.toLowerCase()).toContain("powershell");
    expect(ps1.args).toContain("-File");
    const bat = resolveHelperCommand("C:\\\\tools\\\\h.bat", "win32");
    expect(bat.cmd.toLowerCase()).toContain("cmd.exe");
    expect(bat.windowsVerbatimArguments).toBe(true);
    const unix = resolveHelperCommand("/bin/helper", "darwin");
    expect(unix).toEqual({ cmd: "/bin/helper", args: [] });
  });

  it("pni validates header names/values", () => {
    expect(validateHelperHeaders({ Authorization: "Bearer x" })).toEqual({
      Authorization: "Bearer x",
    });
    expect(validateHelperHeaders({ "Bad Name": "x" })).toBeNull();
    expect(validateHelperHeaders({ Auth: "line\r\ninject" })).toBeNull();
    expect(validateHelperHeaders({ Auth: 1 })).toBeNull();
    expect(validateHelperHeaders(null)).toBeNull();
    const many: Record<string, string> = {};
    for (let i = 0; i < 33; i++) many[`H${i}`] = "v";
    expect(validateHelperHeaders(many)).toBeNull();
  });
});
