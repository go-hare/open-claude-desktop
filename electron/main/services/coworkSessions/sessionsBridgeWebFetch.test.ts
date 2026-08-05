import { describe, expect, it } from "vitest";
import {
  extractUrlsForWebFetchProvenance,
  normalizeProvenanceUrl,
  stripUrlMatchTrailing,
} from "./sessionsBridgeWebFetch";

describe("extractUrlsForWebFetchProvenance (_1i residual)", () => {
  it("returns empty for non-string / empty", () => {
    expect(extractUrlsForWebFetchProvenance("")).toEqual([]);
    expect(extractUrlsForWebFetchProvenance(null as never)).toEqual([]);
  });

  it("extracts absolute http(s) URLs", () => {
    const urls = extractUrlsForWebFetchProvenance(
      "see https://example.com/a and http://foo.dev/b?x=1",
    );
    expect(urls).toContain("https://example.com/a");
    expect(urls).toContain("http://foo.dev/b?x=1");
    expect(urls[0]).toBe("https://example.com/a");
  });

  it("normalizes www.* and bare domains to https", () => {
    const urls = extractUrlsForWebFetchProvenance(
      "check www.example.com and openai.com/path please",
    );
    expect(urls).toContain("https://www.example.com/");
    expect(urls).toContain("https://openai.com/path");
  });

  it("strips trailing punctuation (owA)", () => {
    expect(
      extractUrlsForWebFetchProvenance("link https://example.com/x."),
    ).toEqual(["https://example.com/x"]);
    expect(stripUrlMatchTrailing("https://example.com/x).")).toBe(
      "https://example.com/x",
    );
  });

  it("strips unmatched closers; keeps balanced closer (owA)", () => {
    expect(stripUrlMatchTrailing("example.com)")).toBe("example.com");
    // balanced: one open + one close → keep trailing )
    expect(stripUrlMatchTrailing("(example.com)")).toBe("(example.com)");
  });

  it("dedupes same host+path; www vs apex stay distinct", () => {
    const urls = extractUrlsForWebFetchProvenance(
      "https://a.com https://a.com/ https://a.com",
    );
    // absolute + bare may both appear; absolute path "/" vs stripped path still tM-normalized
    expect(urls.filter((u) => u === "https://a.com/" || u === "https://a.com").length).toBe(1);
    const mixed = extractUrlsForWebFetchProvenance(
      "https://a.com www.a.com",
    );
    // www host ≠ apex host under official tM
    expect(mixed.some((u) => u.includes("www.a.com"))).toBe(true);
    expect(mixed.some((u) => u === "https://a.com/" || u === "https://a.com")).toBe(true);
  });

  it("does not treat email local-part as bare domain mid-token", () => {
    // R1i requires (?<!\\S) — "user@example.com" has @ before host so host may still match
    // after @ only if token boundary; official lookbehind is non-whitespace.
    // "user@example.com" — host starts after @ which is non-whitespace → no bare match for example.com
    const urls = extractUrlsForWebFetchProvenance("contact user@example.com please");
    expect(urls.every((u) => !u.includes("example.com"))).toBe(true);
  });

  it("does not invent ftp/mailto absolute schemes as http", () => {
    // y1i only matches http(s); ftp:// is not extracted
    expect(
      extractUrlsForWebFetchProvenance("see ftp://files.example.com/x"),
    ).toEqual([]);
    expect(normalizeProvenanceUrl("ftp://files.example.com/x")).toBeNull();
  });

  it("tM strips hash and trailing slash on non-root path", () => {
    expect(normalizeProvenanceUrl("https://example.com/a/b/#frag")).toBe(
      "https://example.com/a/b",
    );
    expect(normalizeProvenanceUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });
});
