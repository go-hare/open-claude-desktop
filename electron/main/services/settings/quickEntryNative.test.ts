import { describe, expect, it, beforeEach } from "vitest";
import {
  applyRecentChatsFromWeb,
  getActiveChatIdStore,
  getRecentChatsStore,
  normalizeRecentChatItems,
  resetQuickEntryNativeForTests,
} from "./quickEntryNative";

describe("quickEntryNative recent chat keys (AUe residual)", () => {
  beforeEach(() => {
    resetQuickEntryNativeForTests();
  });

  it("normalizes official { chatId, chatName } keys", () => {
    expect(
      normalizeRecentChatItems([
        { chatId: "a-1", chatName: "Hello" },
        { chatId: "b-2", chatName: "World" },
      ]),
    ).toEqual([
      { chatId: "a-1", chatName: "Hello" },
      { chatId: "b-2", chatName: "World" },
    ]);
  });

  it("maps legacy uuid/name to chatId/chatName (ion-dist residual)", () => {
    expect(
      normalizeRecentChatItems([
        { uuid: "u-1", name: "Legacy" },
        { uuid: "u-2" },
      ]),
    ).toEqual([
      { chatId: "u-1", chatName: "Legacy" },
      { chatId: "u-2", chatName: "Untitled" },
    ]);
  });

  it("drops invalid items; prefers chatId over uuid", () => {
    expect(
      normalizeRecentChatItems([
        null,
        42,
        { name: "no-id" },
        { chatId: "keep", uuid: "ignore", chatName: "Kept", name: "ignore-name" },
      ]),
    ).toEqual([{ chatId: "keep", chatName: "Kept" }]);
  });

  it("applyRecentChatsFromWeb stores chats + activeChatId (WX residual)", () => {
    const result = applyRecentChatsFromWeb(
      [{ chatId: "c1", chatName: "One" }],
      "c1",
    );
    expect(result).toEqual([{ chatId: "c1", chatName: "One" }]);
    expect(getRecentChatsStore()).toEqual([{ chatId: "c1", chatName: "One" }]);
    expect(getActiveChatIdStore()).toBe("c1");

    applyRecentChatsFromWeb([], null);
    expect(getRecentChatsStore()).toEqual([]);
    expect(getActiveChatIdStore()).toBeNull();
  });
});
