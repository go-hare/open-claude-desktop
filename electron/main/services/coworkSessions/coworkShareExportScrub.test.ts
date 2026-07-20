import { expect, it } from "vitest";
import {
  COWORK_SHARE_SCRUB_LINE_MAX,
  scrubCoworkShareEmails,
  scrubCoworkShareExportFile,
  scrubCoworkShareIps,
  scrubCoworkShareJsonValue,
  scrubCoworkShareLineBody,
  scrubCoworkShareLogLine,
  scrubCoworkSharePaths,
  scrubCoworkShareTokens,
} from "./coworkShareExportScrub";

it("S1/$LA scrubs email ip tokens and paths", () => {
  expect(scrubCoworkShareEmails("mail me at a.b@example.com please")).toBe(
    "mail me at <email> please",
  );
  expect(scrubCoworkShareIps("from 10.0.0.1 and 12:34:56 clock")).toBe(
    "from <ip> and 12:34:56 clock",
  );
  expect(scrubCoworkShareTokens("Bearer abcdefghijklmnop")).toContain(
    "Bearer <token>",
  );
  expect(scrubCoworkShareTokens("key sk-ant-abcdefghi")).toContain("<token>");
  expect(
    scrubCoworkSharePaths("/Users/alice/work/file.txt", {
      homedir: "/Users/alice",
    }),
  ).toBe("~/work/file.txt");
  expect(
    scrubCoworkSharePaths("/Users/bob/x", { homedir: "/other" }),
  ).toBe("/Users/<user>/x");
  expect(
    scrubCoworkShareLineBody(
      "auth Bearer tokentok and sk-ant-12345678 at alice@x.com via 1.2.3.4",
      { homedir: "/Users/alice" },
    ),
  ).toContain("<token>");
});

it("szt truncates long lines then scrubs", () => {
  const long = `prefix sk-ant-abcdefgh ${"x".repeat(COWORK_SHARE_SCRUB_LINE_MAX)}`;
  const out = scrubCoworkShareLogLine(long);
  // Official marker uses U+2026 ellipsis: "…<truncated>"
  expect(out).toContain("…<truncated>");
  expect(out).not.toContain("...<truncated>");
  expect(out).toContain("<token>");
  expect(out.length).toBeLessThan(long.length);
});

it("B7 recursive json skipKeys and scrubString", () => {
  const value = {
    platform: "darwin",
    app_version: "1.2.3",
    secret: "sk-ant-abcdefgh",
    nested: { email: "a@b.co", path: "/Users/alice/a" },
  };
  const scrubbed = scrubCoworkShareJsonValue(value, {
    homedir: "/Users/alice",
  }) as Record<string, unknown>;
  expect(scrubbed.platform).toBe("darwin");
  expect(scrubbed.app_version).toBe("1.2.3");
  expect(String(scrubbed.secret)).toContain("<token>");
  const nested = scrubbed.nested as Record<string, unknown>;
  expect(String(nested.email)).toBe("<email>");
  expect(String(nested.path)).toBe("~/a");
});

it("S1 transforms .log/.json/.jsonl; unknown extension identity", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const paths = { homedir: "/Users/alice", appPath: "/App/Claude.app" };

  const logOut = scrubCoworkShareExportFile(
    "app.log",
    enc("user alice@x.com token sk-ant-abcdefgh path /Users/alice/p\n"),
    paths,
  );
  const logText = new TextDecoder().decode(logOut);
  expect(logText).toContain("<email>");
  expect(logText).toContain("<token>");
  expect(logText).toContain("~/p");

  const jsonOut = scrubCoworkShareExportFile(
    "state.json",
    enc(JSON.stringify({ platform: "darwin", note: "sk-ant-abcdefgh" })),
    paths,
  );
  const json = JSON.parse(new TextDecoder().decode(jsonOut)) as Record<
    string,
    unknown
  >;
  expect(json.platform).toBe("darwin");
  expect(String(json.note)).toContain("<token>");

  const jsonlOut = scrubCoworkShareExportFile(
    "events.jsonl",
    enc('{"msg":"a@b.co"}\nnot-json sk-ant-abcdefgh\n'),
    paths,
  );
  const jsonl = new TextDecoder().decode(jsonlOut);
  expect(jsonl.split("\n")[0]).toContain("<email>");
  expect(jsonl.split("\n")[1]).toContain("<token>");

  const bin = enc("raw-bytes");
  expect(scrubCoworkShareExportFile("blob.bin", bin, paths)).toBe(bin);
});

it("S1 onError returns raw bytes when scrub throws", () => {
  const bad = new TextEncoder().encode("{not-json");
  const errors: string[] = [];
  const out = scrubCoworkShareExportFile("broken.json", bad, {
    onError: (_err, name) => {
      errors.push(name);
    },
  });
  expect(out).toEqual(bad);
  expect(errors).toEqual(["broken.json"]);
});
