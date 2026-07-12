import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createRuntimeState } from "../coworkSessions/coworkSessionState";
import {
  createCoworkRawTranscriptLoader,
  parseCoworkTranscriptLines,
} from "./coworkTranscriptJsonl";

it("loads the raw JSONL entry with camel-case toolUseResult intact", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "cowork-transcript-"));
  const projectDir = join(configDir, "projects", "-tmp-project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "cli-session-1.jsonl"),
    `${JSON.stringify({
      message: {
        content: [
          {
            content: "answer recorded",
            tool_use_id: "ask-1",
            type: "tool_result",
          },
        ],
      },
      toolUseResult: { answers: { Question: "OK" } },
      type: "user",
      uuid: "answer-1",
    })}\n`,
  );
  const session = createRuntimeState(
    { hostLoopMode: true, message: "hello", userSelectedFolders: ["/tmp/project"] },
    "local_session-1",
    "session-1",
    1,
  );
  session.cliSessionId = "cli-session-1";

  const messages = await createCoworkRawTranscriptLoader(configDir)(session);

  expect(messages?.[0]?.toolUseResult).toEqual({ answers: { Question: "OK" } });
});

it("matches the official preserved-segment compact boundary filtering", () => {
  const lines = [
    { type: "user", uuid: "head", parentUuid: null },
    { type: "assistant", uuid: "tail", parentUuid: "head" },
    { type: "user", uuid: "discarded", parentUuid: null },
    {
      compactMetadata: { preservedSegment: { headUuid: "head", tailUuid: "tail" } },
      subtype: "compact_boundary",
      type: "system",
      uuid: "boundary",
    },
    { type: "assistant", uuid: "after", parentUuid: "boundary" },
    { isCompactSummary: true, type: "user", uuid: "summary" },
    { isVisibleInTranscriptOnly: true, type: "assistant", uuid: "hidden" },
  ].map((entry) => JSON.stringify(entry));

  expect(
    parseCoworkTranscriptLines(lines, { dropPreBoundary: true }).map((item) => item.uuid),
  ).toEqual(["head", "tail", "after"]);
});
