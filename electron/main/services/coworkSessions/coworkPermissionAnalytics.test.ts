import { afterEach, expect, it, vi } from "vitest";
import {
  clearCoworkPermissionAnalyticsForTests,
  setCoworkPermissionAnalyticsSink,
  trackCoworkPermissionAnalytics,
} from "./coworkPermissionAnalytics";

afterEach(() => {
  clearCoworkPermissionAnalyticsForTests();
});

it("routes trackCoworkPermissionAnalytics through the active sink", () => {
  const sink = vi.fn();
  setCoworkPermissionAnalyticsSink(sink);
  trackCoworkPermissionAnalytics("lam_tool_permission_requested", {
    permission_mode: "default",
    request_id: "req-1",
    session_id: "session-1",
    session_type: "cowork",
    tool_name: "Read",
    user_message_uuid: "msg-1",
  });
  expect(sink).toHaveBeenCalledWith({
    name: "lam_tool_permission_requested",
    props: expect.objectContaining({
      request_id: "req-1",
      session_type: "cowork",
      tool_name: "Read",
    }),
  });
});

it("swallows sink errors so permission flow is never blocked", () => {
  setCoworkPermissionAnalyticsSink(() => {
    throw new Error("sink down");
  });
  expect(() =>
    trackCoworkPermissionAnalytics("lam_tool_permission_stalled", {
      permission_mode: null,
      request_id: "req-1",
      seconds_waiting: 300,
      session_id: "session-1",
      session_type: "cowork",
      tool_name: "Write",
      user_message_uuid: null,
    }),
  ).not.toThrow();
});
