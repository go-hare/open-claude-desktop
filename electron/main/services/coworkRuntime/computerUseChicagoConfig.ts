/**
 * Official chicago GrowthBook residual (app.asar):
 *   const fU = "1291166712"
 *   CTi = { pixelValidation:false, clipboardPasteMultiline:true, mouseAnimation:true,
 *           hideBeforeAction:true, autoTargetDisplay:true, clipboardGuard:true }
 *   lTi = "pixels"
 *   $5() = wr(fU, key, CTi[key], boolean) for each sub-gate
 *   oq() = wr(fU, "coordinateMode", lTi, enum pixels|normalized_0_100)  (cached)
 *   pZe() = wr(fU, "teachModeEnabled", true, boolean)  (cached; hZe force-on → true)
 *
 * Product: read GrowthBook feature value object when present; never invent non-default
 * sub-gates. Defaults match CTi / lTi / teachModeEnabled:true.
 */
import type { CuSubGates } from "@ant/computer-use-mcp";
import { getCoworkGrowthBookFeatureValue } from "../coworkHostLoop/coworkGrowthBookFeatures";
import { DEFAULT_CU_SUB_GATES } from "./computerUseDarwinExecutor";

/** Official fU residual — chicago_config feature id. */
export const CHICAGO_GROWTHBOOK_FEATURE_ID = "1291166712";

export type ComputerUseCoordinateMode = "pixels" | "normalized_0_100";

type ChicagoConfigBag = {
  enabled?: unknown;
  pixelValidation?: unknown;
  clipboardPasteMultiline?: unknown;
  mouseAnimation?: unknown;
  hideBeforeAction?: unknown;
  autoTargetDisplay?: unknown;
  clipboardGuard?: unknown;
  coordinateMode?: unknown;
  teachModeEnabled?: unknown;
  dispatchCuGrantTtlMs?: unknown;
};

function readChicagoConfigRaw(): ChicagoConfigBag | undefined {
  const raw = getCoworkGrowthBookFeatureValue<unknown>(
    CHICAGO_GROWTHBOOK_FEATURE_ID,
    undefined,
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as ChicagoConfigBag;
}

function readBool(
  bag: ChicagoConfigBag | undefined,
  key: keyof ChicagoConfigBag,
  fallback: boolean,
): boolean {
  if (!bag) return fallback;
  const v = bag[key];
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Official $5 residual — CuSubGates from chicago_config object keys, CTi defaults.
 */
export function getComputerUseSubGates(): CuSubGates {
  const bag = readChicagoConfigRaw();
  const d = DEFAULT_CU_SUB_GATES;
  return {
    pixelValidation: readBool(bag, "pixelValidation", d.pixelValidation),
    clipboardPasteMultiline: readBool(
      bag,
      "clipboardPasteMultiline",
      d.clipboardPasteMultiline,
    ),
    mouseAnimation: readBool(bag, "mouseAnimation", d.mouseAnimation),
    hideBeforeAction: readBool(bag, "hideBeforeAction", d.hideBeforeAction),
    autoTargetDisplay: readBool(bag, "autoTargetDisplay", d.autoTargetDisplay),
    clipboardGuard: readBool(bag, "clipboardGuard", d.clipboardGuard),
  };
}

/**
 * Official oq residual — coordinateMode pixels | normalized_0_100.
 * Product does not cache across process lifetime beyond GB map; GB value is stable.
 */
export function getComputerUseCoordinateMode(): ComputerUseCoordinateMode {
  const bag = readChicagoConfigRaw();
  const mode = bag?.coordinateMode;
  if (mode === "normalized_0_100" || mode === "pixels") return mode;
  return "pixels";
}

/**
 * Official pZe residual — teachModeEnabled (default true when unset).
 */
export function getComputerUseTeachModeEnabled(): boolean {
  const bag = readChicagoConfigRaw();
  return readBool(bag, "teachModeEnabled", true);
}
