/**
 * Official P_A residual (app.asar):
 *   async function P_A(e){
 *     if(e.length===0)return;
 *     if(win32) unhideComputerUseAppsWin32…
 *     await (await fE()).apps.unhide(e)
 *   }
 * Called on leavingRunning / turn end when chicagoAutoUnhide && cuHiddenDuringTurn.
 *
 * Product: Darwin fE().apps.unhide; Win32 PE cuUnhideApps via createWin32Executor.
 */
import { loadClaudeSwiftComputerUse } from "../settings/claudeSwiftAddon";
import { unhideComputerUseAppsWin32 } from "./computerUse/createWin32Executor";

/**
 * Official P_A — platform unhide. No-op on empty; soft-fail when native missing.
 */
export async function unhideComputerUseApps(bundleIds: string[]): Promise<void> {
  if (!Array.isArray(bundleIds) || bundleIds.length === 0) return;
  if (process.platform === "win32") {
    await unhideComputerUseAppsWin32(bundleIds);
    return;
  }
  if (process.platform !== "darwin") return;
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
