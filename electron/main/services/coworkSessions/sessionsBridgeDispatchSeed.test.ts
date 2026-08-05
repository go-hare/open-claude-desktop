import { describe, expect, it } from "vitest";
import {
  buildDispatchSeedAssistantMessages,
  buildDispatchSeedIdleResult,
  dispatchSeedMessages,
  dispatchSeedUuid,
} from "./sessionsBridgeDispatchSeed";

describe("sessionsBridgeDispatchSeed residual", () => {
  it("GUA base always includes welcome; agent name optional", () => {
    expect(dispatchSeedMessages(false)).toHaveLength(1);
    expect(dispatchSeedMessages(true)).toHaveLength(2);
    expect(dispatchSeedMessages(true)[1]).toMatch(/personal Claude/);
  });

  it("P6i uuid is deterministic and v4-shaped", () => {
    const a = dispatchSeedUuid("sess-1", 0);
    const b = dispatchSeedUuid("sess-1", 0);
    const c = dispatchSeedUuid("sess-1", 1);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("buildDispatchSeedAssistantMessages shape", () => {
    const msgs = buildDispatchSeedAssistantMessages("remote-x", false);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.type).toBe("assistant");
    expect(msgs[0]!.session_id).toBe("remote-x");
    expect(msgs[0]!.message.model).toBe("<synthetic>");
    expect(msgs[0]!.message.content[0]!.name).toBe("SendUserMessage");
    expect(msgs[0]!.message.content[0]!.input.message.length).toBeGreaterThan(10);
  });

  it("idle result residual", () => {
    const r = buildDispatchSeedIdleResult("remote-y");
    expect(r.type).toBe("result");
    expect(r.subtype).toBe("success");
    expect(r.session_id).toBe("remote-y");
    expect(r.is_error).toBe(false);
  });
});
