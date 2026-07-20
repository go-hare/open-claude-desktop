import path from "node:path";
import { expect, it } from "vitest";
import type { CoworkVmPathContext } from "../coworkSessions/coworkVmPathTranslation";
import {
  translateLocalMcpToolArgs,
  translateLocalMcpToolResult,
  withLocalMcpPathTranslation,
  wrapLocalMcpToolHandler,
} from "./coworkLocalMcpPathTranslate";

const context: CoworkVmPathContext = {
  sessionStorageDir: path.join("/tmp", "storage", "session_1"),
  userSelectedFolders: ["/Users/apple/work-py/AppAgent"],
  vmProcessName: "session_1",
};

it("XL-translates VM mnt paths in tool args to host paths", () => {
  const args = {
    path: "/sessions/session_1/mnt/AppAgent/src/main.ts",
  };
  const translated = translateLocalMcpToolArgs(args, context) as typeof args;
  expect(translated.path).toBe(
    path.join("/Users/apple/work-py/AppAgent", "src", "main.ts"),
  );
});

it("no-ops args translation when path context is null", () => {
  const args = { path: "/sessions/session_1/mnt/AppAgent/x" };
  expect(translateLocalMcpToolArgs(args, null)).toBe(args);
});

it("DeA-translates file:// host paths in result content to VM file://", () => {
  const hostFile = `file:///Users/apple/work-py/AppAgent/doc.txt`;
  const result = translateLocalMcpToolResult(
    {
      content: [{ type: "text", text: hostFile }],
      isError: false,
    },
    context,
  );
  const text = (result.content as Array<{ text: string }>)[0].text;
  expect(text).toMatch(/^file:\/\//);
  expect(text).toContain("sessions");
  expect(text).toContain("AppAgent");
  expect(text).not.toContain("Users/apple/work-py");
});

it("withLocalMcpPathTranslation runs XL then DeA around the call", async () => {
  const seen: unknown[] = [];
  const result = await withLocalMcpPathTranslation(
    { path: "/sessions/session_1/mnt/AppAgent/a.txt" },
    context,
    async (args) => {
      seen.push(args);
      return {
        content: [
          {
            type: "text",
            text: `file://${(args as { path: string }).path}`,
          },
        ],
      };
    },
  );
  expect((seen[0] as { path: string }).path).toBe(
    path.join("/Users/apple/work-py/AppAgent", "a.txt"),
  );
  const text = (result.content as Array<{ text: string }>)[0].text;
  expect(text).toContain("/sessions/session_1/mnt/AppAgent");
});

it("wrapLocalMcpToolHandler resolves context per call", async () => {
  let calls = 0;
  const handler = wrapLocalMcpToolHandler(
    () => {
      calls += 1;
      return context;
    },
    async (args: { path: string }) => ({
      content: [{ type: "text", text: args.path }],
    }),
  );
  const out = await handler({
    path: "/sessions/session_1/mnt/AppAgent/z.md",
  });
  expect(calls).toBe(1);
  expect((out.content as Array<{ text: string }>)[0].text).toBe(
    path.join("/Users/apple/work-py/AppAgent", "z.md"),
  );
});
