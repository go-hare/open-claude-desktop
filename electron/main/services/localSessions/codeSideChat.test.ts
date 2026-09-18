import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT,
  OFFICIAL_SIDE_CHAT_NOT_RUNNING,
  OFFICIAL_SIDE_CHAT_SYSTEM_APPEND,
} from "./codeSideChat";

describe("official Side chat residual constants", () => {
  it("systemPrompt append is official Rtr (no tools, not in main transcript)", () => {
    expect(OFFICIAL_SIDE_CHAT_SYSTEM_APPEND).toContain("lightweight fork of the main conversation");
    expect(OFFICIAL_SIDE_CHAT_SYSTEM_APPEND).toContain("NO tools");
    expect(OFFICIAL_SIDE_CHAT_SYSTEM_APPEND).toContain("nothing you say here lands in the main transcript");
  });

  it("no-transcript copy matches official startSideChat gate", () => {
    expect(OFFICIAL_SIDE_CHAT_NO_TRANSCRIPT).toBe(
      "Can't fork yet — send a message in the main chat first so there's a transcript to branch from.",
    );
  });

  it("not-running copy matches official sendSideChatMessage", () => {
    expect(OFFICIAL_SIDE_CHAT_NOT_RUNNING).toBe(
      "Side chat isn't running — reopen the panel to start a new one.",
    );
  });
});
