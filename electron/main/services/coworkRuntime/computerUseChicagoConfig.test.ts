import { afterEach, describe, expect, it } from "vitest";
import {
  applyCoworkGrowthBookFeatures,
  resetCoworkGrowthBookFeaturesForTests,
} from "../coworkHostLoop/coworkGrowthBookFeatures";
import {
  CHICAGO_GROWTHBOOK_FEATURE_ID,
  getComputerUseCoordinateMode,
  getComputerUseSubGates,
  getComputerUseTeachModeEnabled,
} from "./computerUseChicagoConfig";
import { DEFAULT_CU_SUB_GATES } from "./computerUseDarwinExecutor";

describe("computerUseChicagoConfig residual $5/oq/pZe", () => {
  afterEach(() => {
    resetCoworkGrowthBookFeaturesForTests();
  });

  it("defaults match CTi / pixels / teachMode true when GB bag absent", () => {
    expect(getComputerUseSubGates()).toEqual(DEFAULT_CU_SUB_GATES);
    expect(getComputerUseCoordinateMode()).toBe("pixels");
    expect(getComputerUseTeachModeEnabled()).toBe(true);
  });

  it("reads subGates and coordinateMode from chicago_config feature value", () => {
    applyCoworkGrowthBookFeatures({
      [CHICAGO_GROWTHBOOK_FEATURE_ID]: {
        on: true,
        value: {
          enabled: true,
          pixelValidation: true,
          mouseAnimation: false,
          coordinateMode: "normalized_0_100",
          teachModeEnabled: false,
        },
      },
    });
    expect(getComputerUseSubGates()).toEqual({
      pixelValidation: true,
      clipboardPasteMultiline: true,
      mouseAnimation: false,
      hideBeforeAction: true,
      autoTargetDisplay: true,
      clipboardGuard: true,
    });
    expect(getComputerUseCoordinateMode()).toBe("normalized_0_100");
    expect(getComputerUseTeachModeEnabled()).toBe(false);
  });

  it("ignores invalid coordinateMode values", () => {
    applyCoworkGrowthBookFeatures({
      [CHICAGO_GROWTHBOOK_FEATURE_ID]: {
        on: true,
        value: { coordinateMode: "percent" },
      },
    });
    expect(getComputerUseCoordinateMode()).toBe("pixels");
  });
});
