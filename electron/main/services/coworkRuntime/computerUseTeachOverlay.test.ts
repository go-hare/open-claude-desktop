import { describe, expect, it, vi } from "vitest";
import type {
  ComputerUseTeachStepPayload,
  ComputerUseTeachStepResult,
} from "./computerUseTeachOverlay";

/**
 * Session teach bag residual (official pendingTeachStep / resolveTeachStep /
 * onTeachModeActivated) unit-tested without BrowserWindow.
 * Overlay window creation requires Electron main — covered by wiring greps.
 */

type Pending = {
  sessionId: string;
  resolve: (r: ComputerUseTeachStepResult) => void;
};

function makeTeachBag() {
  const sessions = new Map<
    string,
    {
      lifecycleState: string;
      teachModeActive?: boolean;
      teachModeEnteredAt?: number;
      cuSelectedDisplayId?: number;
    }
  >();
  let pendingTeachStep: Pending | undefined;
  const events: Array<{ type: string; payload: unknown }> = [];

  return {
    sessions,
    events,
    get pendingTeachStep() {
      return pendingTeachStep;
    },
    activateTeachMode(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s || s.lifecycleState !== "running") return;
      s.teachModeActive = true;
      s.teachModeEnteredAt = Date.now();
      events.push({
        type: "teachModeChanged",
        payload: { sessionId, active: true },
      });
    },
    requestTeachStep(
      sessionId: string,
      payload: ComputerUseTeachStepPayload,
    ): Promise<ComputerUseTeachStepResult> {
      return new Promise((resolve) => {
        const s = sessions.get(sessionId);
        if (!s?.teachModeActive) {
          resolve({ action: "exit" });
          return;
        }
        if (pendingTeachStep) {
          pendingTeachStep.resolve({ action: "exit" });
        }
        pendingTeachStep = { sessionId, resolve };
        events.push({
          type: "teachStepRequested",
          payload: { sessionId, payload },
        });
      });
    },
    resolveTeachStep(result: ComputerUseTeachStepResult) {
      const t = pendingTeachStep;
      if (!t) return;
      pendingTeachStep = undefined;
      t.resolve(result);
    },
    clearTeachMode(sessionId: string) {
      const s = sessions.get(sessionId);
      if (s) {
        s.teachModeEnteredAt = undefined;
        s.teachModeActive = false;
      }
      this.resolveTeachStep({ action: "exit" });
      events.push({
        type: "teachModeChanged",
        payload: { sessionId, active: false },
      });
    },
  };
}

describe("computerUse teach session bag residual", () => {
  it("activates teach mode only when session is running", () => {
    const bag = makeTeachBag();
    bag.sessions.set("s1", { lifecycleState: "idle" });
    bag.activateTeachMode("s1");
    expect(bag.sessions.get("s1")?.teachModeActive).toBeUndefined();
    expect(bag.events).toHaveLength(0);

    bag.sessions.set("s1", { lifecycleState: "running" });
    bag.activateTeachMode("s1");
    expect(bag.sessions.get("s1")?.teachModeActive).toBe(true);
    expect(bag.sessions.get("s1")?.teachModeEnteredAt).toBeTypeOf("number");
    expect(bag.events[0]).toMatchObject({
      type: "teachModeChanged",
      payload: { sessionId: "s1", active: true },
    });
  });

  it("resolveTeachStep unparks onTeachStep promise with next/exit", async () => {
    const bag = makeTeachBag();
    bag.sessions.set("s1", {
      lifecycleState: "running",
      teachModeActive: true,
    });
    const p = bag.requestTeachStep("s1", {
      explanation: "Click File",
      nextPreview: "Open menu",
      anchorLogical: { x: 10, y: 20 },
    });
    expect(bag.events.some((e) => e.type === "teachStepRequested")).toBe(true);
    bag.resolveTeachStep({ action: "next" });
    await expect(p).resolves.toEqual({ action: "next" });
    expect(bag.pendingTeachStep).toBeUndefined();
  });

  it("teach_step without active mode resolves exit immediately", async () => {
    const bag = makeTeachBag();
    bag.sessions.set("s1", { lifecycleState: "running" });
    await expect(
      bag.requestTeachStep("s1", {
        explanation: "x",
        nextPreview: "y",
      }),
    ).resolves.toEqual({ action: "exit" });
  });

  it("new teach_step while pending resolves old as exit", async () => {
    const bag = makeTeachBag();
    bag.sessions.set("s1", {
      lifecycleState: "running",
      teachModeActive: true,
    });
    const first = bag.requestTeachStep("s1", {
      explanation: "a",
      nextPreview: "b",
    });
    const second = bag.requestTeachStep("s1", {
      explanation: "c",
      nextPreview: "d",
    });
    await expect(first).resolves.toEqual({ action: "exit" });
    bag.resolveTeachStep({ action: "next" });
    await expect(second).resolves.toEqual({ action: "next" });
  });

  it("clearTeachMode resolves pending and emits inactive", async () => {
    const bag = makeTeachBag();
    bag.sessions.set("s1", {
      lifecycleState: "running",
      teachModeActive: true,
      teachModeEnteredAt: 1,
    });
    const p = bag.requestTeachStep("s1", {
      explanation: "a",
      nextPreview: "b",
    });
    bag.clearTeachMode("s1");
    await expect(p).resolves.toEqual({ action: "exit" });
    expect(bag.sessions.get("s1")?.teachModeActive).toBe(false);
    expect(
      bag.events.some(
        (e) =>
          e.type === "teachModeChanged" &&
          (e.payload as { active: boolean }).active === false,
      ),
    ).toBe(true);
  });

  it("userConsented residual gate: package only activates when true", () => {
    // Official handleRequestTeachAccess residual:
    //   granted = [...skipDialogGrants, ...response.granted]
    //   teachModeActive = response.userConsented===true && granted.length>0
    // Empty needDialog (response.granted=[]) still activates when
    // skipDialogGrants non-empty AND userConsented true (SPA Start guide
    // after prior request_access). Missing userConsented → no activate.
    const activate = vi.fn();
    const simulateTeachPermission = (opts: {
      userConsented?: boolean;
      responseGrantedLen: number;
      skipDialogLen: number;
    }) => {
      const grantedLen = opts.skipDialogLen + opts.responseGrantedLen;
      const active = opts.userConsented === true && grantedLen > 0;
      if (active) activate();
    };
    simulateTeachPermission({
      userConsented: true,
      responseGrantedLen: 1,
      skipDialogLen: 0,
    });
    simulateTeachPermission({
      userConsented: false,
      responseGrantedLen: 1,
      skipDialogLen: 0,
    });
    // Already-granted only (SPA empty app list / empty _cuGrants.granted)
    simulateTeachPermission({
      userConsented: true,
      responseGrantedLen: 0,
      skipDialogLen: 1,
    });
    simulateTeachPermission({
      userConsented: true,
      responseGrantedLen: 0,
      skipDialogLen: 0,
    });
    simulateTeachPermission({ responseGrantedLen: 1, skipDialogLen: 0 });
    expect(activate).toHaveBeenCalledTimes(2);
  });
});
