import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coworkVmBundleFileStatus,
  ensureCoworkVmRootfs,
  resolveCoworkVmDownloadBaseUrl,
} from "./coworkVmBundleDownload";
import { COWORK_VM_BUNDLE_SHA } from "./coworkClaudeVm";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function mkTemp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-dl-"));
  tempDirs.push(dir);
  return dir;
}

describe("coworkVmBundleDownload pure helpers", () => {
  it("builds official EGi CDN base URL", () => {
    expect(resolveCoworkVmDownloadBaseUrl("arm64")).toBe(
      `https://downloads.claude.ai/vms/linux/arm64/${COWORK_VM_BUNDLE_SHA}`,
    );
  });

  it("JZe status: missing / origin_missing / ready / mismatch", () => {
    const bundle = mkTemp();
    expect(coworkVmBundleFileStatus(bundle, "rootfs.img")).toEqual({
      ready: false,
      reason: "missing",
    });
    fs.writeFileSync(path.join(bundle, "rootfs.img"), "x");
    expect(coworkVmBundleFileStatus(bundle, "rootfs.img")).toEqual({
      ready: false,
      reason: "origin_missing",
    });
    fs.writeFileSync(
      path.join(bundle, ".rootfs.img.origin"),
      COWORK_VM_BUNDLE_SHA,
    );
    expect(coworkVmBundleFileStatus(bundle, "rootfs.img")).toEqual({ ready: true });
    fs.writeFileSync(path.join(bundle, ".rootfs.img.origin"), "other-sha");
    expect(coworkVmBundleFileStatus(bundle, "rootfs.img").ready).toBe(false);
  });
});

describe("ensureCoworkVmRootfs", () => {
  it("skips network when rootfs already present (legacy bare)", async () => {
    const bundle = mkTemp();
    fs.writeFileSync(path.join(bundle, "rootfs.img"), "legacy");
    let downloads = 0;
    const result = await ensureCoworkVmRootfs(bundle, {
      platform: "darwin",
      arch: "arm64",
      downloadToFile: async () => {
        downloads += 1;
        return { sha256: "nope" };
      },
    });
    expect(result.ok).toBe(true);
    expect(downloads).toBe(0);
    expect(fs.readFileSync(path.join(bundle, ".rootfs.img.origin"), "utf8")).toBe(
      COWORK_VM_BUNDLE_SHA,
    );
  });

  it("downloads zst, verifies checksum, decompresses, writes origin", async () => {
    const bundle = mkTemp();
    let seenUrl = "";
    const result = await ensureCoworkVmRootfs(bundle, {
      platform: "darwin",
      arch: "arm64",
      downloadToFile: async (url, dest) => {
        seenUrl = url;
        fs.writeFileSync(dest, "zst-bytes");
        const { listCoworkVmBundleFiles } = await import("./coworkVmBundleDownload");
        const expected = listCoworkVmBundleFiles("darwin", "arm64")[0]!.checksum;
        return { sha256: expected };
      },
      decompressZst: async (_zst, out) => {
        fs.writeFileSync(out, "decompressed-rootfs");
      },
    });
    expect(result.ok).toBe(true);
    expect(result.downloaded).toBe(true);
    expect(seenUrl).toContain(
      `/vms/linux/arm64/${COWORK_VM_BUNDLE_SHA}/rootfs.img.zst`,
    );
    expect(fs.readFileSync(path.join(bundle, "rootfs.img"), "utf8")).toBe(
      "decompressed-rootfs",
    );
    expect(fs.readFileSync(path.join(bundle, ".rootfs.img.origin"), "utf8")).toBe(
      COWORK_VM_BUNDLE_SHA,
    );
  });

  it("fails honestly on checksum mismatch without inventing ready bundle", async () => {
    const bundle = mkTemp();
    const result = await ensureCoworkVmRootfs(bundle, {
      platform: "darwin",
      arch: "arm64",
      downloadToFile: async (_url, dest) => {
        fs.writeFileSync(dest, "bad");
        return { sha256: "deadbeef" };
      },
      decompressZst: async () => {
        throw new Error("should not decompress");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Checksum mismatch/);
    expect(fs.existsSync(path.join(bundle, "rootfs.img"))).toBe(false);
  });
});
