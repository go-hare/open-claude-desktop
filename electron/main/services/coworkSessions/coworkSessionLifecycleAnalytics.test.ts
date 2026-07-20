import { afterEach, expect, it, vi } from "vitest";
import {
  buildCoworkSessionArchivedProps,
  buildCoworkSessionStoppedProps,
  clearCoworkSessionLifecycleAnalyticsForTests,
  getCoworkVmInstanceId,
  resolveCoworkTranscriptSizeBytes,
  resetCoworkVmInstanceIdForTests,
  setCoworkSessionLifecycleAnalyticsSink,
  shouldTrackCoworkSessionStopped,
  trackCoworkSessionLifecycleAnalytics,
} from "./coworkSessionLifecycleAnalytics";

afterEach(() => {
  clearCoworkSessionLifecycleAnalyticsForTests();
});

it("routes trackCoworkSessionLifecycleAnalytics through the active sink", () => {
  const sink = vi.fn();
  setCoworkSessionLifecycleAnalyticsSink(sink);
  trackCoworkSessionLifecycleAnalytics("lam_session_stopped", {
    session_id: "s1",
    cli_session_id: "cli-1",
    vm_instance_id: "vm-1",
    session_type: "cowork",
    total_turns: 2,
    session_duration_ms: 1000,
    transcript_size_bytes: 42,
  });
  expect(sink).toHaveBeenCalledWith({
    name: "lam_session_stopped",
    props: expect.objectContaining({
      session_id: "s1",
      total_turns: 2,
      transcript_size_bytes: 42,
    }),
  });
});

it("swallows sink errors so stop/archive is never blocked", () => {
  setCoworkSessionLifecycleAnalyticsSink(() => {
    throw new Error("sink down");
  });
  expect(() =>
    trackCoworkSessionLifecycleAnalytics("lam_session_archived", {
      session_id: "s1",
      cli_session_id: null,
      vm_instance_id: "vm-1",
      total_turns: 0,
      session_duration_ms: 10,
      transcript_size_bytes: undefined,
    }),
  ).not.toThrow();
});

it("shouldTrackCoworkSessionStopped matches official force + Wl gates", () => {
  expect(
    shouldTrackCoworkSessionStopped({
      force: true,
      hadQuery: true,
      wasRunning: true,
    }),
  ).toBe(false);
  expect(
    shouldTrackCoworkSessionStopped({
      force: false,
      hadQuery: true,
      wasRunning: false,
    }),
  ).toBe(true);
  expect(
    shouldTrackCoworkSessionStopped({
      force: false,
      hadQuery: false,
      wasRunning: true,
    }),
  ).toBe(true);
  expect(
    shouldTrackCoworkSessionStopped({
      force: false,
      hadQuery: false,
      wasRunning: false,
    }),
  ).toBe(false);
  // Official Wl: stopping/initializing count as active (not only "running").
  expect(
    shouldTrackCoworkSessionStopped({
      force: false,
      hadQuery: false,
      wasRunning: false,
      lifecycleState: "stopping",
    }),
  ).toBe(true);
  expect(
    shouldTrackCoworkSessionStopped({
      force: false,
      hadQuery: false,
      wasRunning: true,
      lifecycleState: "idle",
    }),
  ).toBe(false);
});

it("build stopped props include session_type; archived omit it", () => {
  const stopped = buildCoworkSessionStoppedProps({
    sessionId: "s1",
    cliSessionId: "cli",
    sessionType: "cowork",
    totalTurns: 3,
    sessionDurationMs: 50,
    transcriptSizeBytes: 9,
    vmInstanceId: "vm",
  });
  expect(stopped).toEqual({
    session_id: "s1",
    cli_session_id: "cli",
    vm_instance_id: "vm",
    session_type: "cowork",
    total_turns: 3,
    session_duration_ms: 50,
    transcript_size_bytes: 9,
  });
  const archived = buildCoworkSessionArchivedProps({
    sessionId: "s1",
    cliSessionId: null,
    totalTurns: 3,
    sessionDurationMs: 50,
    transcriptSizeBytes: undefined,
    vmInstanceId: "vm",
  });
  expect(archived).toEqual({
    session_id: "s1",
    cli_session_id: null,
    vm_instance_id: "vm",
    total_turns: 3,
    session_duration_ms: 50,
    transcript_size_bytes: undefined,
  });
  expect("session_type" in archived).toBe(false);
});

it("getCoworkVmInstanceId is stable process singleton (Wn residual)", () => {
  resetCoworkVmInstanceIdForTests();
  const a = getCoworkVmInstanceId();
  const b = getCoworkVmInstanceId();
  expect(a).toBe(b);
  expect(a.length).toBeGreaterThan(8);
});

it("resolveCoworkTranscriptSizeBytes uses transcriptFilePath then projects scan", async () => {
  const size = await resolveCoworkTranscriptSizeBytes(
    {
      sessionId: "s1",
      cliSessionId: "cli",
      transcriptFilePath: "/tmp/t.jsonl",
    },
    {
      lstatSize: async (p) => (p === "/tmp/t.jsonl" ? 123 : undefined),
    },
  );
  expect(size).toBe(123);

  const scanned = await resolveCoworkTranscriptSizeBytes(
    { sessionId: "s1", cliSessionId: "cli-abc" },
    {
      sessionStorageDir: "/sessions/s1",
      readdir: async () => ["proj1"],
      lstatSize: async (p) =>
        p.endsWith("cli-abc.jsonl") ? 77 : undefined,
    },
  );
  expect(scanned).toBe(77);

  const missing = await resolveCoworkTranscriptSizeBytes(
    { sessionId: "s1", cliSessionId: undefined },
    { sessionStorageDir: "/x" },
  );
  expect(missing).toBeUndefined();
});
