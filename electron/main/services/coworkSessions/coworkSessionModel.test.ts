import { expect, it } from "vitest";
import {
  applyCowork1mContextModelSuffix,
  coerceCoworkModelArg,
  hasCoworkSyntheticAllowedModels,
  listCoworkAllowedModels,
  lookupCoworkEffortByModel,
  normalizeCoworkEffortByModelValue,
  resolveCoworkEffortForModel,
  resolveCoworkSessionModel,
  resolveCoworkSetModelChange,
  resolveCoworkSyntheticModel,
  type CoworkModelConfig,
} from "./coworkSessionModel";

const syntheticConfig: CoworkModelConfig = {
  allowedModels: ["claude-sonnet-4-5", "claude-opus-4-6"],
  syntheticAllowedModels: {
    "Max Thinking": "claude-opus-4-6",
    Sonnet: "claude-sonnet-4-5",
  },
  effortByModel: {
    "Max Thinking": "high",
    "claude-opus-4-6": "xhigh",
    "claude-sonnet-4-5": "medium",
  },
  supports1mContext: ["claude-opus-4-6", "claude-sonnet-4-6"],
};

it("coerceCoworkModelArg mirrors official WJ", () => {
  expect(coerceCoworkModelArg("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
  expect(coerceCoworkModelArg({ id: "id-1" })).toBe("id-1");
  expect(coerceCoworkModelArg({ name: "name-1" })).toBe("name-1");
  expect(coerceCoworkModelArg({ id: "id-1", name: "name-1" })).toBe("id-1");
  expect(coerceCoworkModelArg(null)).toBeUndefined();
  expect(coerceCoworkModelArg(42)).toBeUndefined();
});

it("r2/aK synthetic map resolve", () => {
  expect(hasCoworkSyntheticAllowedModels(null)).toBe(false);
  expect(hasCoworkSyntheticAllowedModels({})).toBe(false);
  expect(hasCoworkSyntheticAllowedModels(syntheticConfig)).toBe(true);
  expect(resolveCoworkSyntheticModel("Max Thinking", syntheticConfig)).toBe(
    "claude-opus-4-6",
  );
  expect(resolveCoworkSyntheticModel("claude-sonnet-4-5", syntheticConfig)).toBe(
    "claude-sonnet-4-5",
  );
  expect(resolveCoworkSyntheticModel("unknown", null)).toBe("unknown");
});

it("KwA resolveCoworkSessionModel allowed list + fallback undefined", () => {
  expect(resolveCoworkSessionModel("default", syntheticConfig)).toBe("default");
  expect(resolveCoworkSessionModel("Max Thinking", syntheticConfig)).toBe(
    "Max Thinking",
  );
  expect(resolveCoworkSessionModel("claude-opus-4-6", syntheticConfig)).toBe(
    "claude-opus-4-6",
  );
  // Not in keys/values/allowed when synthetic map present → undefined
  expect(resolveCoworkSessionModel("totally-unknown", syntheticConfig)).toBe(
    undefined,
  );

  // Without synthetic map: includes match on bare id
  const allowedOnly: CoworkModelConfig = {
    allowedModels: ["claude-sonnet-4-5"],
  };
  expect(resolveCoworkSessionModel("claude-sonnet-4-5[1m]", allowedOnly)).toBe(
    "claude-sonnet-4-5[1m]",
  );
  expect(resolveCoworkSessionModel("claude-haiku-3", allowedOnly)).toBe(
    undefined,
  );
  // No allowed list → passthrough
  expect(resolveCoworkSessionModel("anything", null)).toBe("anything");
});

it("listCoworkAllowedModels merges synthetic keys/values + allowed", () => {
  const list = listCoworkAllowedModels(syntheticConfig)!;
  expect(list).toContain("Max Thinking");
  expect(list).toContain("claude-opus-4-6");
  expect(list).toContain("claude-sonnet-4-5");
});

it("Kk applyCowork1mContextModelSuffix", () => {
  expect(
    applyCowork1mContextModelSuffix("claude-opus-4-6", syntheticConfig, true),
  ).toBe("claude-opus-4-6[1m]");
  expect(
    applyCowork1mContextModelSuffix(
      "claude-opus-4-6[1m]",
      syntheticConfig,
      true,
    ),
  ).toBe("claude-opus-4-6[1m]");
  expect(
    applyCowork1mContextModelSuffix("claude-opus-4-6", syntheticConfig, false),
  ).toBe("claude-opus-4-6");
  expect(
    applyCowork1mContextModelSuffix("claude-sonnet-4-5", syntheticConfig, true),
  ).toBe("claude-sonnet-4-5");
  // Default supports list when config empty
  expect(applyCowork1mContextModelSuffix("claude-sonnet-4-6", null, true)).toBe(
    "claude-sonnet-4-6[1m]",
  );
});

it("AEe/pdA/bRA effort lookup", () => {
  expect(normalizeCoworkEffortByModelValue("xhigh")).toBe("xhigh");
  expect(normalizeCoworkEffortByModelValue("unset")).toBe("unset");
  expect(normalizeCoworkEffortByModelValue("nope")).toBeUndefined();

  expect(
    lookupCoworkEffortByModel(
      { "claude-opus-4-6": "high", opus: "low" },
      "claude-opus-4-6[1m]",
    ),
  ).toBe("high");

  expect(resolveCoworkEffortForModel("Max Thinking", syntheticConfig)).toBe(
    "high",
  );
  expect(resolveCoworkEffortForModel("claude-opus-4-6", syntheticConfig)).toBe(
    "xhigh",
  );
  expect(resolveCoworkEffortForModel("missing", syntheticConfig)).toBe(
    undefined,
  );
});

it("resolveCoworkSetModelChange: same model noop", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    requestedModel: "claude-sonnet-4-5",
  });
  expect(result).toEqual({ action: "noop" });
});

it("resolveCoworkSetModelChange: same overrideLabel noop for synthetic", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-opus-4-6[1m]",
    currentOverrideLabel: "Max Thinking",
    modelConfig: syntheticConfig,
    requestedModel: "Max Thinking",
  });
  expect(result).toEqual({ action: "noop" });
});

it("resolveCoworkSetModelChange: stale synthetic ignored when map active", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    modelConfig: syntheticConfig,
    requestedModel: "Stale Chip",
  });
  expect(result).toEqual({
    action: "ignore_stale_synthetic",
    requested: "Stale Chip",
  });
});

it("resolveCoworkSetModelChange: mid-session lock", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    lockMidSessionModel: true,
    messageBufferLength: 2,
    requestedModel: "claude-opus-4-6",
  });
  expect(result.action).toBe("ignore_mid_session_lock");
  if (result.action === "ignore_mid_session_lock") {
    expect(result.from).toBe("claude-sonnet-4-5");
    expect(result.to).toBe("claude-opus-4-6");
  }
});

it("resolveCoworkSetModelChange: mid-session lock via cachedTotalTurns", () => {
  const result = resolveCoworkSetModelChange({
    cachedTotalTurns: 3,
    currentModel: "claude-sonnet-4-5",
    lockMidSessionModel: true,
    messageBufferLength: 0,
    requestedModel: "claude-opus-4-6",
  });
  expect(result.action).toBe("ignore_mid_session_lock");
});

it("resolveCoworkSetModelChange: cross-target live synthetic ignored", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    currentOverrideLabel: "Sonnet",
    hasLiveQuery: true,
    modelConfig: syntheticConfig,
    requestedModel: "Max Thinking",
  });
  expect(result.action).toBe("ignore_cross_target_live");
});

it("resolveCoworkSetModelChange: apply plain model + 1m + effort", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    modelConfig: syntheticConfig,
    requestedModel: "claude-opus-4-6",
  });
  expect(result.action).toBe("apply");
  if (result.action === "apply") {
    expect(result.nextModel).toBe("claude-opus-4-6[1m]");
    expect(result.nextOverrideLabel).toBeUndefined();
    expect(result.notifyLabel).toBe("claude-opus-4-6[1m]");
    expect(result.previousModel).toBe("claude-sonnet-4-5");
    expect(result.effortLevel).toBe("xhigh");
    expect(result.shouldCallQuerySetModel).toBe(true);
  }
});

it("resolveCoworkSetModelChange: apply synthetic remap sets overrideLabel notify", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    hasLiveQuery: false,
    modelConfig: syntheticConfig,
    requestedModel: "Max Thinking",
  });
  expect(result.action).toBe("apply");
  if (result.action === "apply") {
    expect(result.nextModel).toBe("claude-opus-4-6[1m]");
    expect(result.nextOverrideLabel).toBe("Max Thinking");
    expect(result.notifyLabel).toBe("Max Thinking");
    expect(result.effortLevel).toBe("high");
  }
});

it("resolveCoworkSetModelChange: object model arg via WJ", () => {
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    requestedModel: { id: "claude-haiku-3" },
  });
  expect(result.action).toBe("apply");
  if (result.action === "apply") {
    expect(result.nextModel).toBe("claude-haiku-3");
    expect(result.notifyLabel).toBe("claude-haiku-3");
  }
});

it("resolveCoworkSetModelChange: KwA miss without synthetic falls back default then applies", () => {
  const config: CoworkModelConfig = {
    allowedModels: ["claude-sonnet-4-5"],
  };
  // unknown → KwA undefined → t becomes "default" → apply if current differs
  const result = resolveCoworkSetModelChange({
    currentModel: "claude-sonnet-4-5",
    modelConfig: config,
    requestedModel: "totally-unknown",
  });
  expect(result.action).toBe("apply");
  if (result.action === "apply") {
    expect(result.nextModel).toBe("default");
    expect(result.notifyLabel).toBe("default");
  }
});
