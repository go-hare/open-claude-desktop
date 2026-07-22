import { describe, expect, it } from "vitest";
import {
  assertValidAcceleratorInPreferenceValue,
  isValidElectronAccelerator,
} from "./electronAccelerator";

describe("isValidElectronAccelerator (ent residual)", () => {
  it("accepts official modifiers and letter keys", () => {
    expect(isValidElectronAccelerator("CommandOrControl+Shift+P")).toBe(true);
    expect(isValidElectronAccelerator("Alt+Space")).toBe(true);
    expect(isValidElectronAccelerator("Ctrl+Alt+Space")).toBe(true);
    expect(isValidElectronAccelerator("F12")).toBe(true);
    expect(isValidElectronAccelerator("numadd")).toBe(true);
  });

  it("rejects unsupported tokens", () => {
    expect(isValidElectronAccelerator("")).toBe(false);
    expect(isValidElectronAccelerator("Foo+Bar")).toBe(false);
    expect(isValidElectronAccelerator("Ctrl+NotAKey")).toBe(false);
    expect(isValidElectronAccelerator("F25")).toBe(false);
  });

  it("assertValidAcceleratorInPreferenceValue only checks object form", () => {
    expect(assertValidAcceleratorInPreferenceValue("off").ok).toBe(true);
    expect(
      assertValidAcceleratorInPreferenceValue({ accelerator: "Ctrl+A" }).ok,
    ).toBe(true);
    expect(
      assertValidAcceleratorInPreferenceValue({ accelerator: "BadKey+Z" }).ok,
    ).toBe(false);
  });
});
