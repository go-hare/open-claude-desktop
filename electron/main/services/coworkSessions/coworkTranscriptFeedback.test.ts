import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  findCoworkSessionTranscriptJsonl,
  isCoworkTranscriptFeedback,
  isCoworkTranscriptFeedbackStep,
  readCoworkTranscriptFeedback,
  submitCoworkTranscriptFeedback,
  type CoworkTranscriptFeedback,
} from "./coworkTranscriptFeedback";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cowork-feedback-"));
  temps.push(dir);
  return dir;
}

const sample: CoworkTranscriptFeedback = {
  freeText: "too slow",
  steps: [{ toolUseId: "tu-1", thumb: "down", note: null }],
  submittedAt: 1_700_000_000_000,
};

it("YUt/G$A validators match official shape", () => {
  expect(isCoworkTranscriptFeedbackStep(sample.steps[0])).toBe(true);
  expect(
    isCoworkTranscriptFeedbackStep({ toolUseId: "x", thumb: 1, note: null }),
  ).toBe(false);
  expect(isCoworkTranscriptFeedback(sample)).toBe(true);
  expect(
    isCoworkTranscriptFeedback({ freeText: "a", steps: [], submittedAt: "x" }),
  ).toBe(false);
  expect(
    isCoworkTranscriptFeedback({ freeText: 1, steps: [], submittedAt: 1 }),
  ).toBe(false);
});

it("Nit readCoworkTranscriptFeedback: missing / non-array / array", async () => {
  const dir = tempDir();
  expect(await readCoworkTranscriptFeedback(dir)).toEqual([]);

  writeFileSync(join(dir, "feedback.json"), JSON.stringify({ no: "array" }));
  expect(await readCoworkTranscriptFeedback(dir)).toEqual([]);

  writeFileSync(join(dir, "feedback.json"), JSON.stringify([sample]));
  expect(await readCoworkTranscriptFeedback(dir)).toEqual([sample]);
});

it("rXi finds newest jsonl under .claude/projects", async () => {
  const dir = tempDir();
  expect(await findCoworkSessionTranscriptJsonl(dir)).toBeNull();

  const p1 = join(dir, ".claude", "projects", "proj-a");
  const p2 = join(dir, ".claude", "projects", "proj-b");
  mkdirSync(p1, { recursive: true });
  mkdirSync(p2, { recursive: true });
  writeFileSync(join(p1, "old.jsonl"), "a");
  // ensure newer mtime
  await new Promise((r) => setTimeout(r, 15));
  writeFileSync(join(p2, "new.jsonl"), "b");

  const found = await findCoworkSessionTranscriptJsonl(dir);
  expect(found).toBe(join(p2, "new.jsonl"));
});

it("tXi appends feedback.json and bundles via injects", async () => {
  const dir = tempDir();
  const downloads = tempDir();
  const shown: string[] = [];
  const tarCalls: Array<{ cwd: string; file: string; paths: string[] }> = [];

  // seed older feedback
  writeFileSync(join(dir, "feedback.json"), JSON.stringify([sample], null, 2));
  // seed transcript
  const proj = join(dir, ".claude", "projects", "p1");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "sess.jsonl"), '{"x":1}\n');

  const second: CoworkTranscriptFeedback = {
    freeText: "ok",
    steps: [{ toolUseId: "tu-2", thumb: null, note: "n" }],
    submittedAt: 2,
  };

  const ok = await submitCoworkTranscriptFeedback(dir, "local_s1", second, {
    createTarGz: async (opts) => {
      tarCalls.push(opts);
      writeFileSync(opts.file, "fake-tar");
    },
    downloadsDir: downloads,
    now: () => new Date("2026-07-20T01:02:03.456Z"),
    showItemInFolder: (path) => {
      shown.push(path);
    },
  });

  expect(ok).toBe(true);
  const stored = JSON.parse(
    readFileSync(join(dir, "feedback.json"), "utf8"),
  ) as CoworkTranscriptFeedback[];
  expect(stored).toHaveLength(2);
  expect(stored[1]).toEqual(second);
  expect(tarCalls).toHaveLength(1);
  expect(tarCalls[0]?.paths).toEqual(["feedback.json", "transcript.jsonl"]);
  expect(shown[0]).toMatch(/cowork-feedback-local_s1-2026-07-20_01-02-03\.tar\.gz$/);
});

it("tXi without jsonl still bundles feedback-only; bundle fail → false", async () => {
  const dir = tempDir();
  const downloads = tempDir();

  const okOnly = await submitCoworkTranscriptFeedback(dir, "s", sample, {
    createTarGz: async (opts) => {
      writeFileSync(opts.file, "x");
    },
    downloadsDir: downloads,
  });
  expect(okOnly).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, "feedback.json"), "utf8"))).toEqual([
    sample,
  ]);

  const dir2 = tempDir();
  const fail = await submitCoworkTranscriptFeedback(dir2, "s", sample, {
    createTarGz: async () => {
      throw new Error("tar boom");
    },
    downloadsDir: downloads,
  });
  // feedback still written even when bundle fails
  expect(JSON.parse(readFileSync(join(dir2, "feedback.json"), "utf8"))).toEqual([
    sample,
  ]);
  expect(fail).toBe(false);
});
