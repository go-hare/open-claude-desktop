/**
 * Official LocalAgentModeSessionManager setModel pure helpers
 * (app.asar WJ / r2 / aK / Kk / KwA / AEe / pdA / bRA / 658929541 lock).
 *
 * Product injects config (kI residual) — no invented Statsig / model catalog store.
 */

/** Official ZQi — effort values for global effort default. */
export const COWORK_EFFORT_VALUES = new Set([
  "low",
  "medium",
  "high",
  "max",
] as const);

/** Official zQi — effort values accepted by effortByModel / applyFlagSettings. */
export const COWORK_EFFORT_BY_MODEL_VALUES = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "unset",
] as const);

export type CoworkEffortValue =
  | "low"
  | "medium"
  | "high"
  | "max"
  | "xhigh"
  | "unset";

/**
 * Official kI() subset used by setModel helpers. Product injects; when unset,
 * helpers degrade to identity / no-op the same way as empty official config.
 */
export type CoworkModelConfig = {
  allowedModels?: readonly string[] | null;
  effortByModel?: Readonly<Record<string, string>> | null;
  supports1mContext?: readonly string[] | null;
  syntheticAllowedModels?: Readonly<Record<string, string>> | null;
};

/** Official dXi default 1m-context model id substrings when CVe() unset. */
export const COWORK_DEFAULT_1M_MODEL_IDS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
] as const;

/**
 * Official WJ(e): coerce setModel first arg to string id / name.
 *   string → e; object with id|name → that field; else undefined.
 */
export function coerceCoworkModelArg(
  value: unknown,
): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as { id?: unknown; name?: unknown };
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.name === "string") return obj.name;
  }
  return undefined;
}

/**
 * Official aK(): syntheticAllowedModels has any keys.
 */
export function hasCoworkSyntheticAllowedModels(
  config: CoworkModelConfig | null | undefined,
): boolean {
  const map = config?.syntheticAllowedModels;
  return map != null && Object.keys(map).length > 0;
}

/**
 * Official r2(e): map synthetic label → real model id (else e).
 */
export function resolveCoworkSyntheticModel(
  model: string | null | undefined,
  config: CoworkModelConfig | null | undefined,
): string | undefined {
  if (!model) return model ?? undefined;
  const mapped = config?.syntheticAllowedModels?.[model];
  return mapped ?? model;
}

/**
 * Official lVe(): allowed model list for KwA.
 *   synthetic map present → keys + values + allowedModels
 *   else filtered allowedModels (non-empty strings) or undefined
 */
export function listCoworkAllowedModels(
  config: CoworkModelConfig | null | undefined,
): string[] | undefined {
  const synthetic = config?.syntheticAllowedModels;
  const allowed = config?.allowedModels;
  if (synthetic != null && Object.keys(synthetic).length > 0) {
    return [
      ...Object.keys(synthetic),
      ...Object.values(synthetic),
      ...(Array.isArray(allowed) ? allowed : []),
    ];
  }
  if (!Array.isArray(allowed)) return undefined;
  const filtered = allowed.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Official CVe(): supports1mContext non-empty string array or undefined.
 */
export function listCoworkSupports1mContext(
  config: CoworkModelConfig | null | undefined,
): string[] | undefined {
  const list = config?.supports1mContext;
  if (!Array.isArray(list)) return undefined;
  const filtered = list.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Official Kk(e): append `[1m]` when feature on + model matches 1m list and
 * does not already contain `[1m]`.
 *
 * `enable1mContextAppend` injects official ft("3885610113") (default true in
 * product when unset so unit tests can pin behavior).
 */
export function applyCowork1mContextModelSuffix(
  model: string,
  config: CoworkModelConfig | null | undefined,
  enable1mContextAppend: boolean = true,
): string {
  if (/\[1m\]/i.test(model)) return model;
  if (!enable1mContextAppend) return model;
  const supports =
    listCoworkSupports1mContext(config) ?? [...COWORK_DEFAULT_1M_MODEL_IDS];
  if (!supports.some((id) => model.includes(id))) return model;
  return `${model}[1m]`;
}

/**
 * Official KwA(e, source, sessionId): if model not in allowed list → undefined
 * (caller falls back to "default"). Empty/default short-circuit to e.
 * Does not emit je analytics (product residual).
 */
export function resolveCoworkSessionModel(
  model: string | null | undefined,
  config: CoworkModelConfig | null | undefined,
): string | undefined {
  if (!model || model === "default") return model ?? undefined;
  const allowed = listCoworkAllowedModels(config);
  if (!allowed) return model;
  const bare = model.replace(/\[.*\]$/, "");
  if (hasCoworkSyntheticAllowedModels(config)) {
    if (allowed.includes(model) || allowed.includes(bare)) return model;
    return undefined;
  }
  const ok = allowed.some((entry) => {
    const entryBare = entry.replace(/\[.*\]$/, "");
    return bare.includes(entryBare) || entryBare.includes(bare);
  });
  return ok ? model : undefined;
}

/**
 * Official AEe(effortByModel, model): lookup with bare id + longest includes key.
 */
export function lookupCoworkEffortByModel(
  effortByModel: Readonly<Record<string, string>>,
  model: string,
): string | undefined {
  const bare = model.replace(/\[.*\]$/, "");
  const direct = effortByModel[model] ?? effortByModel[bare];
  if (direct != null) return direct;
  const key = Object.keys(effortByModel)
    .filter((entry) => entry.length > 0 && bare.includes(entry))
    .sort((a, b) => b.length - a.length)[0];
  return key ? effortByModel[key] : undefined;
}

/**
 * Official pdA(e): value in zQi else undefined.
 */
export function normalizeCoworkEffortByModelValue(
  value: string | null | undefined,
): CoworkEffortValue | undefined {
  if (value == null) return undefined;
  return COWORK_EFFORT_BY_MODEL_VALUES.has(
    value as CoworkEffortValue,
  )
    ? (value as CoworkEffortValue)
    : undefined;
}

/**
 * Official bRA(e): effort for model from kI().effortByModel (+ synthetic map).
 */
export function resolveCoworkEffortForModel(
  model: string | null | undefined,
  config: CoworkModelConfig | null | undefined,
): CoworkEffortValue | undefined {
  if (!model) return undefined;
  const effortByModel = config?.effortByModel;
  if (!effortByModel) return undefined;
  const synthetic = config?.syntheticAllowedModels;
  if (synthetic == null || Object.keys(synthetic).length === 0) {
    return normalizeCoworkEffortByModelValue(
      lookupCoworkEffortByModel(effortByModel, model),
    );
  }
  const direct = normalizeCoworkEffortByModelValue(effortByModel[model]);
  if (direct != null) return direct;
  const mapped = synthetic[model];
  if (mapped != null) {
    return normalizeCoworkEffortByModelValue(
      lookupCoworkEffortByModel(effortByModel, mapped),
    );
  }
  return undefined;
}

export type CoworkSetModelResolveInput = {
  /** Current session.model (SDK target id, possibly with [1m]). */
  currentModel?: string | null;
  /** Current session.overrideLabel (synthetic display label). */
  currentOverrideLabel?: string | null;
  /** Official ft("3885610113") for Kk [1m] append. Default true. */
  enable1mContextAppend?: boolean;
  /**
   * Official ft("658929541") mid-session lock. When true and session has
   * buffered messages or cached turns, ignore the change.
   */
  lockMidSessionModel?: boolean;
  /** kI() config inject. */
  modelConfig?: CoworkModelConfig | null;
  /** Official setModel second arg (string or {id|name}). */
  requestedModel: unknown;
  /** session.cachedTotalTurns residual (optional). */
  cachedTotalTurns?: number | null;
  /** session.messageBuffer.length. */
  messageBufferLength?: number;
  /** Whether a live query exists (cross-target arm guard). */
  hasLiveQuery?: boolean;
};

export type CoworkSetModelResolveResult =
  | { action: "noop" }
  | { action: "ignore_stale_synthetic"; requested: string }
  | {
      action: "ignore_mid_session_lock";
      from: string | undefined;
      to: string;
    }
  | {
      action: "ignore_cross_target_live";
      fromOverride: string | null | undefined;
      to: string;
    }
  | {
      action: "apply";
      /** Label for notify: override display when synthetic remapped else SDK model. */
      notifyLabel: string;
      /** SDK model id after Kk (may include [1m]). */
      nextModel: string;
      /** overrideLabel when synthetic remapped; else clear. */
      nextOverrideLabel: string | undefined;
      previousModel: string | undefined;
      /** bRA effort; applyFlagSettings when defined. */
      effortLevel?: CoworkEffortValue;
      /** Whether SDK setModel should be called (same SDK id may skip). */
      shouldCallQuerySetModel: boolean;
    };

/**
 * Official setModel pure decision (before await query.setModel / notify).
 *
 * Flow:
 *   WJ → KwA (stale synthetic short-circuit) → default → r2 → isSynthetic
 *   → Kk → same-label noop → mid-session lock → cross-target live guard
 *   → apply { nextModel, overrideLabel, effort, notifyLabel }
 */
export function resolveCoworkSetModelChange(
  input: CoworkSetModelResolveInput,
): CoworkSetModelResolveResult {
  const config = input.modelConfig ?? null;
  const coerced = coerceCoworkModelArg(input.requestedModel);
  // Official: KwA(WJ(t)??t, ...) — if WJ undefined, still pass raw t when string.
  const rawRequested =
    coerced ??
    (typeof input.requestedModel === "string"
      ? input.requestedModel
      : undefined);
  if (rawRequested === undefined) {
    return { action: "noop" };
  }

  const resolvedOrUndef = resolveCoworkSessionModel(rawRequested, config);
  if (
    resolvedOrUndef === undefined &&
    (hasCoworkSyntheticAllowedModels(config) ||
      input.currentOverrideLabel != null)
  ) {
    return { action: "ignore_stale_synthetic", requested: rawRequested };
  }

  // Official: t = i ?? "default"
  let requested = resolvedOrUndef ?? "default";
  const mapped = resolveCoworkSyntheticModel(requested, config) ?? requested;
  const isSyntheticRemap = mapped !== requested;
  const nextModel = applyCowork1mContextModelSuffix(
    mapped,
    config,
    input.enable1mContextAppend !== false,
  );
  const currentModel = input.currentModel ?? undefined;
  const sameSdkModel =
    currentModel === nextModel || currentModel === mapped;
  // Official: if(o?r.overrideLabel===t:a) return
  if (isSyntheticRemap) {
    if (input.currentOverrideLabel === requested) {
      return { action: "noop" };
    }
  } else if (sameSdkModel) {
    return { action: "noop" };
  }

  if (
    input.lockMidSessionModel &&
    ((input.messageBufferLength ?? 0) > 0 ||
      (input.cachedTotalTurns ?? 0) > 0)
  ) {
    return {
      action: "ignore_mid_session_lock",
      from: currentModel,
      to: requested,
    };
  }

  if (isSyntheticRemap && !sameSdkModel && input.hasLiveQuery) {
    return {
      action: "ignore_cross_target_live",
      fromOverride: input.currentOverrideLabel,
      to: requested,
    };
  }

  const effortLevel = resolveCoworkEffortForModel(requested, config);
  return {
    action: "apply",
    notifyLabel: isSyntheticRemap ? requested : nextModel,
    nextModel,
    nextOverrideLabel: isSyntheticRemap ? requested : undefined,
    previousModel: currentModel,
    effortLevel,
    shouldCallQuerySetModel: !sameSdkModel,
  };
}
