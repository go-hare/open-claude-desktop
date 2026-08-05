import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySaveToDiskScreenshotNote,
  writeScreenshotToOutputsDir,
} from "./computerUseScreenshotPersist";

describe("computerUseScreenshotPersist residual h9e", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  it("writes screenshot-<ts>.png under outputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cu-shot-"));
    dirs.push(dir);
    const payload = Buffer.from("fake-jpeg-bytes").toString("base64");
    const path = await writeScreenshotToOutputsDir(
      dir,
      payload,
      "image/jpeg",
    );
    expect(path).toBeTruthy();
    expect(path!).toMatch(/screenshot-\d+\.jpg$/);
    const written = await readFile(path!);
    expect(written.equals(Buffer.from("fake-jpeg-bytes"))).toBe(true);
  });

  it("h9e unshifts note when persist returns path", async () => {
    const result = {
      content: [
        { type: "image", data: "abc", mimeType: "image/png" },
        { type: "text", text: "ok" },
      ],
    };
    await applySaveToDiskScreenshotNote(result, async () => "/tmp/shot.png");
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Screenshot saved to: /tmp/shot.png Include this path in your response so it can be attached for the user.",
    });
  });

  it("h9e no-ops on isError or missing image", async () => {
    const err = {
      isError: true as const,
      content: [{ type: "image", data: "x", mimeType: "image/png" }],
    };
    await applySaveToDiskScreenshotNote(err, async () => "/tmp/x.png");
    expect(err.content).toHaveLength(1);

    const noImage = { content: [{ type: "text", text: "nope" }] };
    await applySaveToDiskScreenshotNote(noImage, async () => "/tmp/x.png");
    expect(noImage.content).toHaveLength(1);
  });
});
