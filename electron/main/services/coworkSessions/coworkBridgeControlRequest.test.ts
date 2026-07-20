import { expect, it, vi } from "vitest";
import {
  extractCoworkBridgeControlRequestId,
  handleCoworkBridgeInterruptControlRequest,
  isCoworkBridgeInterruptControlRequest,
  resolveCoworkBridgeInterruptControlRequest,
} from "./coworkBridgeControlRequest";

it("isCoworkBridgeInterruptControlRequest only for interrupt subtype", () => {
  expect(
    isCoworkBridgeInterruptControlRequest({
      type: "control_request",
      request: { subtype: "interrupt" },
    }),
  ).toBe(true);
  expect(
    isCoworkBridgeInterruptControlRequest({
      type: "control_request",
      request: { subtype: "mcp_message" },
    }),
  ).toBe(false);
  expect(
    isCoworkBridgeInterruptControlRequest({ type: "user", request: {} }),
  ).toBe(false);
  expect(isCoworkBridgeInterruptControlRequest(null)).toBe(false);
});

it("extractCoworkBridgeControlRequestId reads string request_id", () => {
  expect(
    extractCoworkBridgeControlRequestId({
      type: "control_request",
      request_id: "req-1",
      request: { subtype: "interrupt" },
    }),
  ).toBe("req-1");
  expect(extractCoworkBridgeControlRequestId({ request_id: 12 })).toBeNull();
});

it("resolve outcomes match official no_session / no_local / interrupted", () => {
  const msg = {
    type: "control_request",
    request_id: "r1",
    request: { subtype: "interrupt" },
  };
  expect(
    resolveCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-1",
      message: msg,
      activeSession: null,
    }),
  ).toMatchObject({
    outcome: "no_session",
    analytics: {
      session_id: "remote-1",
      local_session_id: null,
      request_id: "r1",
      outcome: "no_session",
    },
  });
  expect(
    resolveCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-1",
      message: msg,
      activeSession: { localSessionId: null },
    }).outcome,
  ).toBe("no_local_session");
  expect(
    resolveCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-1",
      message: msg,
      activeSession: { localSessionId: "local_abc" },
    }),
  ).toMatchObject({
    outcome: "interrupted",
    localSessionId: "local_abc",
    analytics: {
      local_session_id: "local_abc",
      outcome: "interrupted",
    },
  });
  expect(
    resolveCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-1",
      message: { type: "control_request", request: { subtype: "other" } },
      activeSession: { localSessionId: "x" },
    }).outcome,
  ).toBe("ignored_non_interrupt");
});

it("handleCoworkBridgeInterruptControlRequest calls interruptTurn only when interrupted", async () => {
  const interruptTurn = vi.fn(async () => undefined);
  const track = vi.fn();
  const sessions = new Map([
    ["remote-ok", { localSessionId: "local_ok" }],
  ]);

  await expect(
    handleCoworkBridgeInterruptControlRequest({
      remoteSessionId: "missing",
      message: {
        type: "control_request",
        request_id: "a",
        request: { subtype: "interrupt" },
      },
      getActiveSession: (id) => sessions.get(id),
      interruptTurn,
      track,
    }),
  ).resolves.toBe("no_session");
  expect(interruptTurn).not.toHaveBeenCalled();
  expect(track).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: "no_session" }),
  );

  await expect(
    handleCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-ok",
      message: {
        type: "control_request",
        request_id: "b",
        request: { subtype: "interrupt" },
      },
      getActiveSession: (id) => sessions.get(id),
      interruptTurn,
      track,
    }),
  ).resolves.toBe("interrupted");
  expect(interruptTurn).toHaveBeenCalledWith("local_ok");
  expect(track).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "interrupted",
      local_session_id: "local_ok",
      request_id: "b",
    }),
  );

  // non-interrupt: no track, no interrupt
  interruptTurn.mockClear();
  track.mockClear();
  await expect(
    handleCoworkBridgeInterruptControlRequest({
      remoteSessionId: "remote-ok",
      message: {
        type: "control_request",
        request: { subtype: "set_permission_mode" },
      },
      getActiveSession: (id) => sessions.get(id),
      interruptTurn,
      track,
    }),
  ).resolves.toBe("ignored_non_interrupt");
  expect(interruptTurn).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
});

it("handle swallows track errors and still interrupts", async () => {
  const interruptTurn = vi.fn(async () => undefined);
  await expect(
    handleCoworkBridgeInterruptControlRequest({
      remoteSessionId: "r",
      message: {
        type: "control_request",
        request: { subtype: "interrupt" },
      },
      getActiveSession: () => ({ localSessionId: "local_1" }),
      interruptTurn,
      track: () => {
        throw new Error("track down");
      },
    }),
  ).resolves.toBe("interrupted");
  expect(interruptTurn).toHaveBeenCalledWith("local_1");
});
