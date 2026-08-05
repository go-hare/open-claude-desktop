import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrbitDeploysResidual,
  orbitDeploysFilePath,
  parseOrbitDeploysFile,
} from "./orbitDeploysResidual";
import {
  deployPreviewNestUnavailableResidual,
  NEST_DEPLOY_UNAVAILABLE,
  NEST_UNPUBLISH_UNAVAILABLE,
  unpublishDeployNestUnavailableResidual,
} from "./launchDeployPreviewResidual";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) await fs.rm(d, { recursive: true, force: true });
  }
});

describe("orbitDeploysResidual", () => {
  it("parses official file shape", () => {
    expect(parseOrbitDeploysFile({ deploys: { a: { url: "https://x", pinned: true } } })).toEqual({
      deploys: { a: { url: "https://x", pinned: true } },
    });
    expect(parseOrbitDeploysFile({})).toEqual({ deploys: {} });
  });

  it("getAllJson returns string map; setDeploy preserves pin", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-"));
    tmpDirs.push(dir);
    const store = new OrbitDeploysResidual(orbitDeploysFilePath(dir));

    const empty = await store.getAllJson();
    expect(typeof empty).toBe("string");
    expect(JSON.parse(empty)).toEqual({});

    await store.setDeploy("app1", "https://example.com");
    await store.setPinned("app1", true);
    await store.setDeploy("app1", "https://example.com/v2");

    const all = JSON.parse(await store.getAllJson()) as Record<
      string,
      { url: string; pinned: boolean }
    >;
    expect(all.app1).toEqual({ url: "https://example.com/v2", pinned: true });

    await store.removeDeploy("app1");
    expect(JSON.parse(await store.getAllJson())).toEqual({});
  });
});

describe("launchDeployPreviewResidual", () => {
  it("Nest-unavailable deploy emits failed and returns false", () => {
    const events: Array<{ id: string; e: unknown }> = [];
    const result = deployPreviewNestUnavailableResidual("srv-1", (id, e) => {
      events.push({ id, e });
    });
    expect(result).toBe(false);
    expect(events).toEqual([
      {
        id: "srv-1",
        e: { type: "failed", error: NEST_DEPLOY_UNAVAILABLE },
      },
    ]);
  });

  it("Nest-unavailable unpublish returns official string", () => {
    expect(unpublishDeployNestUnavailableResidual()).toBe(
      NEST_UNPUBLISH_UNAVAILABLE,
    );
  });
});
