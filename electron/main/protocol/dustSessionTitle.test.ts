import { describe, expect, it } from "vitest";
import {
  DUST_FIRST_MESSAGE_MAX,
  DUST_SESSION_TITLE_MAX,
  localDustBranchNameFromTitle,
  localDustSessionTitleFromMessage,
  normalizeDustFirstSessionMessage,
} from "./dustSessionTitle";

describe("localDustSessionTitleFromMessage", () => {
  it("returns empty for blank / pure digit / placeholders", () => {
    expect(localDustSessionTitleFromMessage("")).toBe("");
    expect(localDustSessionTitleFromMessage("   ")).toBe("");
    expect(localDustSessionTitleFromMessage("12345")).toBe("");
    expect(localDustSessionTitleFromMessage("General coding session")).toBe("");
    expect(localDustSessionTitleFromMessage("Coding session")).toBe("");
    expect(localDustSessionTitleFromMessage(null)).toBe("");
  });

  it("uses first line and keeps short prompts", () => {
    expect(localDustSessionTitleFromMessage("fix the login OAuth flow for desktop")).toBe(
      "fix the login OAuth flow for desktop",
    );
    expect(localDustSessionTitleFromMessage("line one\nline two more text")).toBe("line one");
  });

  it("strips uploaded_files and truncates long first lines at word boundary", () => {
    const long = "please ".repeat(20) + "finish the remaining work items today";
    const title = localDustSessionTitleFromMessage(
      `<uploaded_files>a.txt</uploaded_files>\n${long}`,
    );
    expect(title.length).toBeLessThanOrEqual(DUST_SESSION_TITLE_MAX + 1); // + ellipsis
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toContain("uploaded_files");
  });

  it("normalizes first_session_message to residual max", () => {
    const raw = "x".repeat(DUST_FIRST_MESSAGE_MAX + 80);
    expect(normalizeDustFirstSessionMessage(raw)).toHaveLength(DUST_FIRST_MESSAGE_MAX);
  });
});

describe("localDustBranchNameFromTitle", () => {
  it("kebab-cases title for branch residual", () => {
    expect(localDustBranchNameFromTitle("Fix the Login Flow")).toBe("fix-the-login-flow");
    expect(localDustBranchNameFromTitle("")).toBe("session");
  });
});
