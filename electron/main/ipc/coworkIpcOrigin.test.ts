import { expect, it } from "vitest";
import { isAllowedCoworkRendererUrl } from "./coworkIpcOrigin";

it("accepts the official app and Claude renderer origins", () => {
  expect(isAllowedCoworkRendererUrl("app://localhost/cowork", false)).toBe(true);
  expect(isAllowedCoworkRendererUrl("https://claude.ai/cowork", false)).toBe(true);
  expect(isAllowedCoworkRendererUrl("https://preview.claude.com/cowork", false)).toBe(true);
});

it("only accepts localhost and ant.dev when developer origins are enabled", () => {
  expect(isAllowedCoworkRendererUrl("http://localhost:5176/cowork", true)).toBe(true);
  expect(isAllowedCoworkRendererUrl("https://dev.ant.dev/cowork", true)).toBe(true);
  expect(isAllowedCoworkRendererUrl("http://localhost:5176/cowork", false)).toBe(false);
});

it("rejects untrusted origins and lookalike hostnames", () => {
  expect(isAllowedCoworkRendererUrl("https://claude.ai.example.com/cowork", true)).toBe(false);
  expect(isAllowedCoworkRendererUrl("file:///tmp/index.html", true)).toBe(false);
  expect(isAllowedCoworkRendererUrl("not a url", true)).toBe(false);
});

