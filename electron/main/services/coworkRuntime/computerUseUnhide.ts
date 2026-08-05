/**
 * Official P_A residual (app.asar):
 *   async function P_A(e){
 *     if(e.length===0)return;
 *     if(win32) unhideComputerUseAppsWin32…
 *     await (await fE()).apps.unhide(e)
 *   }
 * Called on leavingRunning / turn end when chicagoAutoUnhide && cuHiddenDuringTurn.
 *
 * Product Mac-only: Darwin fE().apps.unhide. Win32 not productized.
 */
import { loadClaudeSwiftComputerUse } from "../settings/claudeSwiftAddon";

/**
 * Official P_A Darwin branch. No-op on empty; soft-fail when computerUse missing.
 */
export async function unhideComputerUseApps(bundleIds: string[]): Promise<void> {
  if (!Array.isArray(bundleIds) || bundleIds.length === 0) return;
  if (process.platform !== "darwin") {
    // Win32 residual not productized — honest no-op (not invent success).
    return;
  }
  try {
    const cu = await loadClaudeSwiftComputerUse();
    await Promise.resolve(cu?.apps?.unhide?.(bundleIds));
  } catch (error) {
    console.warn(
      "[computer-use] auto-unhide failed (claude-swift computerUse)",
      error,
    );
  }
}
