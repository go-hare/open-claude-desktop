/**
 * Official Hne / VWt / Xo config schema residual (app.asar):
 *
 *   Hne = et({
 *     claudeAiUrl, globalShortcut, mcpServers: Zi(BV),
 *     features: J1t, isHardwareAccelerationDisabled, isCoworkSdkDebuggingEnabled,
 *     isUsingBuiltInNodeForMcp, isDxtAutoUpdatesEnabled, dxtMaxTotalSizeMB,
 *     deploymentMode: Ir(["3p","1p"]), enterpriseConfig: Zi(SC()),
 *     preferences: qOe.optional()
 *   })
 *   BV = et({ command, args?, env?, extensionId? })
 *   VWt: parse → jWt sidebarMode operon strip → Hne.safeParse
 *        fail → $Wt filter invalid mcp → re-parse; still fail → Pne → {}
 *
 * Product residual uses zod (same dependency as official bundle) without inventing
 * enterprise MDM fields. enterpriseConfig is record of unknown (SC residual).
 */
import { z } from "zod";

/** Official BV — stdio MCP server entry. */
export const officialMcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  extensionId: z.string().optional(),
});

export type OfficialMcpServerConfig = z.infer<typeof officialMcpServerSchema>;

/** Official J1t features bag residual (+ catchall boolean). */
export const officialFeaturesSchema = z
  .object({
    isDxtEnabled: z.boolean().optional(),
    isDxtDirectoryEnabled: z.boolean().optional(),
    isLocalDevMcpEnabled: z.boolean().optional(),
    isUvSystemPythonEnabled: z.boolean().optional(),
    isMidnightOwlEnabled: z.boolean().optional(),
    isChicagoEnabled: z.boolean().optional(),
  })
  .catchall(z.boolean())
  .optional();

/**
 * Official qOe preferences fragment used inside Hne.
 * Keep aligned with appPreferencesSchema validators (not full zod mirror of every nested).
 * Unknown extra keys stripped by default zod object (strict residual = pass through optional bag).
 */
export const officialPreferencesSegmentSchema = z
  .object({
    menuBarEnabled: z.boolean().optional(),
    legacyQuickEntryEnabled: z.boolean().optional(),
    chromeExtensionEnabled: z.boolean().optional(),
    chromeExtension: z
      .object({
        pairedDeviceId: z.string().optional(),
        pairedDeviceName: z.string().optional(),
        pairedFromDeviceIds: z.array(z.string()).optional(),
      })
      .optional(),
    quickEntryShortcut: z
      .union([
        z.literal("double-tap-option"),
        z.literal("off"),
        z.object({ accelerator: z.string() }),
      ])
      .optional(),
    quickEntryDictationShortcut: z
      .union([
        z.literal("capslock"),
        z.literal("double-tap-capslock"),
        z.literal("off"),
        z.object({ accelerator: z.string() }),
      ])
      .optional(),
    hardwareBuddyEnabled: z.boolean().optional(),
    plushRaccoonEnabled: z.boolean().optional(),
    quietPenguinEnabled: z.boolean().optional(),
    louderPenguinEnabled: z.boolean().optional(),
    floatingPenguinEnabled: z.boolean().optional(),
    plushRaccoonOption1: z
      .union([z.literal("off"), z.object({ accelerator: z.string() })])
      .optional(),
    plushRaccoonOption2: z
      .union([z.literal("off"), z.object({ accelerator: z.string() })])
      .optional(),
    plushRaccoonOption3: z
      .union([z.literal("off"), z.object({ accelerator: z.string() })])
      .optional(),
    chillingSlothLocation: z.string().optional(),
    ccBranchPrefix: z.string().optional(),
    ccMaxWarmWorktrees: z.number().int().min(0).optional(),
    ccWorktreeReapAfterHours: z.number().min(0).optional(),
    secureVmFeaturesEnabled: z.boolean().optional(),
    launchEnabled: z.boolean().optional(),
    launchPreviewPersistSession: z.boolean().optional(),
    launchPreviewPersistedWorkspaces: z.array(z.string()).optional(),
    localAgentModeTrustedFolders: z.array(z.string()).optional(),
    allowAllBrowserActions: z.boolean().optional(),
    dispatchTrustedCodeWorkspaces: z.array(z.string()).optional(),
    dispatchCodeTasksPermissionMode: z
      .enum(["default", "acceptEdits", "plan", "auto", "bypassPermissions"])
      .optional(),
    coworkScheduledTasksEnabled: z.boolean().optional(),
    ccdScheduledTasksEnabled: z.boolean().optional(),
    sidebarMode: z.enum(["chat", "code", "task", "epitaxy"]).optional(),
    bypassPermissionsModeEnabled: z.boolean().optional(),
    dockBounceEnabled: z.boolean().optional(),
    coworkWebSearchEnabled: z.boolean().optional(),
    coworkDisabledTools: z.array(z.string()).optional(),
    coworkSpaceContextEnabled: z.boolean().optional(),
    keepAwakeEnabled: z.boolean().optional(),
    wakeSchedulerEnabled: z.boolean().optional(),
    wakeSchedulerApprovedThisCycle: z.boolean().optional(),
    wakeSchedulerRegisteredAtVersion: z.string().optional(),
    wakeSchedulerCourtesyFlippedKeepAwake: z.boolean().optional(),
    coworkOnboardingResumeStep: z
      .object({
        step: z.enum(["ios", "setup"]),
        accountKey: z.string(),
      })
      .nullable()
      .optional(),
    chicagoEnabled: z.boolean().optional(),
    remoteToolsDeviceName: z.string().optional(),
    chicagoAutoUnhide: z.boolean().optional(),
    chicagoUserDeniedBundleIds: z.array(z.string()).optional(),
    vmMemoryGB: z.number().int().min(0).optional(),
    vmCpuCount: z.number().int().min(0).optional(),
    ccAutoArchiveOnPrClose: z.boolean().optional(),
    epitaxyPrefs: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Official Hne top-level claude_desktop_config.json schema.
 * enterpriseConfig: residual as record (SC() full enterprise not invent-filled).
 */
export const officialAppConfigSchema = z.object({
  claudeAiUrl: z.string().optional(),
  globalShortcut: z.string().optional(),
  mcpServers: z.record(officialMcpServerSchema).optional(),
  features: officialFeaturesSchema,
  isHardwareAccelerationDisabled: z.boolean().optional(),
  isCoworkSdkDebuggingEnabled: z.boolean().optional(),
  isUsingBuiltInNodeForMcp: z.boolean().optional(),
  isDxtAutoUpdatesEnabled: z.boolean().optional(),
  dxtMaxTotalSizeMB: z.number().optional(),
  deploymentMode: z.enum(["3p", "1p"]).optional(),
  enterpriseConfig: z.record(z.unknown()).optional(),
  preferences: officialPreferencesSegmentSchema.optional(),
}).passthrough();

export type OfficialAppConfig = z.infer<typeof officialAppConfigSchema>;

export type ParseOfficialConfigResult = {
  ok: boolean;
  data: OfficialAppConfig;
  /** Invalid mcp server names skipped (official $Wt). */
  invalidMcpServers: string[];
  /** True when Hne failed and result is empty / filtered residual. */
  usedFallback: boolean;
  error?: string;
};

/**
 * Official jWt residual: strip legacy sidebarMode === "operon".
 */
export function stripLegacySidebarOperon(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const prefs = (raw as { preferences?: unknown }).preferences;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return;
  const bag = prefs as Record<string, unknown>;
  if (bag.sidebarMode === "operon") {
    delete bag.sidebarMode;
  }
}

/**
 * Official $Wt residual: drop MCP entries that fail BV.
 */
export function filterInvalidMcpServers(raw: unknown): {
  filteredConfig: unknown;
  invalidServers: string[];
} {
  if (
    !raw
    || typeof raw !== "object"
    || Array.isArray(raw)
    || !("mcpServers" in raw)
    || !(raw as { mcpServers?: unknown }).mcpServers
    || typeof (raw as { mcpServers: unknown }).mcpServers !== "object"
    || Array.isArray((raw as { mcpServers: unknown }).mcpServers)
  ) {
    return { filteredConfig: raw, invalidServers: [] };
  }
  const invalidServers: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(
    (raw as { mcpServers: Record<string, unknown> }).mcpServers,
  )) {
    if (officialMcpServerSchema.safeParse(entry).success) {
      next[name] = entry;
    } else {
      invalidServers.push(name);
    }
  }
  return {
    filteredConfig: { ...(raw as object), mcpServers: next },
    invalidServers,
  };
}

/**
 * Official VWt body residual (without dialog side-effects).
 * Caller may surface invalidServers / parse errors via dialogs.
 */
export function parseOfficialAppConfig(
  raw: unknown,
): ParseOfficialConfigResult {
  if (raw === null || raw === undefined) {
    return {
      ok: true,
      data: {},
      invalidMcpServers: [],
      usedFallback: false,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      data: {},
      invalidMcpServers: [],
      usedFallback: true,
      error: "config root must be an object",
    };
  }

  // Mutate a shallow clone for jWt.
  const clone = { ...(raw as Record<string, unknown>) };
  if (clone.preferences && typeof clone.preferences === "object" && !Array.isArray(clone.preferences)) {
    clone.preferences = { ...(clone.preferences as Record<string, unknown>) };
  }
  stripLegacySidebarOperon(clone);

  const first = officialAppConfigSchema.safeParse(clone);
  if (first.success) {
    return {
      ok: true,
      data: first.data,
      invalidMcpServers: [],
      usedFallback: false,
    };
  }

  const { filteredConfig, invalidServers } = filterInvalidMcpServers(clone);
  if (invalidServers.length > 0) {
    const second = officialAppConfigSchema.safeParse(filteredConfig);
    if (second.success) {
      return {
        ok: true,
        data: second.data,
        invalidMcpServers: invalidServers,
        usedFallback: false,
      };
    }
  }

  return {
    ok: false,
    data: {},
    invalidMcpServers: invalidServers,
    usedFallback: true,
    error: first.error.message,
  };
}

export function isValidOfficialMcpServer(value: unknown): boolean {
  return officialMcpServerSchema.safeParse(value).success;
}
