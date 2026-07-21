/**
 * Official main-process GrowthBook residual (app.asar Gu / ft / WHe / c9t / kni):
 *
 *   let Gu = {}
 *   function ft(e) { return Gu[e]?.on ?? false }
 *   mZe() = ft("1143815894")  // host-loop feature for v4()
 *
 * 3p deployment mode:
 *   hardcodedMainGrowthBookFeatures() → kni
 *   kni = { "1143815894": { on: true, value: true, source: "force", ... }, ... }
 *
 * 1p:
 *   fetch /api/desktop/features → WHe(features); disk cache fcache
 *
 * Product: seed kni (3p-aligned defaults). Optional applyFeatures for tests / future
 * 1p fetch bridge. Never invent true for unknown flags outside kni/applied map.
 */
import {
  COWORK_HOST_LOOP_FEATURE_FLAG_ID,
} from "./coworkHostLoopMode";

export type CoworkGrowthBookFeature = {
  experiment?: unknown;
  experimentResult?: unknown;
  off?: boolean;
  on: boolean;
  source?: string;
  value?: unknown;
};

/** Official gk / kni — force-on features for 3p deployment mode. */
const FORCE_ON: CoworkGrowthBookFeature = {
  value: true,
  on: true,
  off: false,
  source: "force",
  experiment: null,
  experimentResult: null,
};

/**
 * Official kni (subset product cares about for Cowork host-loop).
 * Full kni also forces other desktop flags; we only seed IDs that policy reads.
 */
export const COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES: Record<
  string,
  CoworkGrowthBookFeature
> = {
  "2976814254": { ...FORCE_ON },
  "3246569822": { ...FORCE_ON },
  [COWORK_HOST_LOOP_FEATURE_FLAG_ID]: { ...FORCE_ON },
  "123929380": { ...FORCE_ON },
  "1696890383": { ...FORCE_ON },
  "2307090146": { ...FORCE_ON },
};

let features: Record<string, CoworkGrowthBookFeature> = {
  ...COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES,
};
let source: "kni" | "applied" | "cleared" = "kni";

/** Official ft(e) — feature on? */
export function isCoworkGrowthBookFeatureOn(flagId: string): boolean {
  const entry = features[flagId];
  return entry?.on === true;
}

/** Official OQ(e, default) — raw value or default. */
export function getCoworkGrowthBookFeatureValue<T>(
  flagId: string,
  defaultValue: T,
): T {
  const entry = features[flagId];
  if (entry === undefined) return defaultValue;
  return (entry.value as T) ?? defaultValue;
}

/** Official mZe — host-loop GrowthBook gate. */
export function isCoworkHostLoopGrowthBookFeatureEnabled(): boolean {
  return isCoworkGrowthBookFeatureOn(COWORK_HOST_LOOP_FEATURE_FLAG_ID);
}

/**
 * Official WHe — replace Gu map (1p /api/desktop/features + fcache).
 * Pass null/undefined to restore kni defaults (3p residual / tests).
 * Pass {} to clear to official empty Gu (1p cold miss — never invent kni).
 */
export function applyCoworkGrowthBookFeatures(
  next: Record<string, CoworkGrowthBookFeature> | null | undefined,
): void {
  if (next === null || next === undefined) {
    features = { ...COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES };
    source = "kni";
    return;
  }
  features = { ...next };
  source = Object.keys(next).length === 0 ? "cleared" : "applied";
}

export function getCoworkGrowthBookFeaturesSource():
  | "kni"
  | "applied"
  | "cleared" {
  return source;
}

/** Test helper — reset to kni. */
export function resetCoworkGrowthBookFeaturesForTests(): void {
  features = { ...COWORK_HARDCODED_MAIN_GROWTHBOOK_FEATURES };
  source = "kni";
}
