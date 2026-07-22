/**
 * Official Electron accelerator key validation residual (app.asar `ent` / `hnr`).
 *
 *   function ent(e) {
 *     return e.split("+").every(t =>
 *       hnr.has(t) || /^[A-Za-z]$/ || /^[0-9]$/ || /^F(1-24)$/ || /^num...$/ || punctuation
 *     );
 *   }
 *
 * Used by setPreference when value is { accelerator: string }.
 */

/** Official hnr Set of Electron accelerator modifiers / special keys. */
export const ELECTRON_ACCELERATOR_MODIFIERS = Object.freeze(
  new Set([
    "Command",
    "Cmd",
    "Control",
    "Ctrl",
    "CommandOrControl",
    "CmdOrCtrl",
    "Alt",
    "Option",
    "AltGr",
    "Shift",
    "Super",
    "Meta",
    "Plus",
    "Space",
    "Tab",
    "Capslock",
    "Numlock",
    "Scrolllock",
    "Backspace",
    "Delete",
    "Insert",
    "Return",
    "Enter",
    "Up",
    "Down",
    "Left",
    "Right",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape",
    "Esc",
    "VolumeUp",
    "VolumeDown",
    "VolumeMute",
    "MediaNextTrack",
    "MediaPreviousTrack",
    "MediaStop",
    "MediaPlayPause",
    "PrintScreen",
  ]),
);

const SINGLE_LETTER = /^[A-Za-z]$/;
const SINGLE_DIGIT = /^[0-9]$/;
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const NUMPAD = /^num([0-9]|dec|add|sub|mult|div)$/;
// Official punctuation class residual (index.js).
const PUNCTUATION = /^[)!@#$%^&*(:;+=<,_\->.?/~`{}\]|[\\'"]$/;

/**
 * Official `ent(accelerator)` — true when every `+`-segment is a supported Electron key.
 * Empty string is invalid for preference objects that require a non-empty accelerator.
 */
export function isValidElectronAccelerator(accelerator: string): boolean {
  if (typeof accelerator !== "string" || accelerator.length === 0) return false;
  return accelerator.split("+").every((part) => {
    if (!part) return false;
    return (
      ELECTRON_ACCELERATOR_MODIFIERS.has(part)
      || SINGLE_LETTER.test(part)
      || SINGLE_DIGIT.test(part)
      || FUNCTION_KEY.test(part)
      || NUMPAD.test(part)
      || PUNCTUATION.test(part)
    );
  });
}

/**
 * Official setPreference guard:
 *   if (typeof g === "object" && g !== null && "accelerator" in g &&
 *       typeof g.accelerator === "string" && g.accelerator !== "" && !ent(g.accelerator))
 *     throw new Error(`Invalid accelerator ...`)
 *
 * Returns true when value does not need accelerator check, or accelerator is valid.
 */
export function assertValidAcceleratorInPreferenceValue(
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (typeof value !== "object" || value === null || !("accelerator" in value)) {
    return { ok: true };
  }
  const accelerator = (value as { accelerator?: unknown }).accelerator;
  if (typeof accelerator !== "string") {
    return { ok: false, reason: "accelerator must be a string" };
  }
  if (accelerator === "") {
    // Official only rejects non-empty invalid; empty string skips ent but may fail shape.
    return { ok: true };
  }
  if (!isValidElectronAccelerator(accelerator)) {
    return {
      ok: false,
      reason: `Invalid accelerator "${accelerator}": contains keys not supported by Electron`,
    };
  }
  return { ok: true };
}
