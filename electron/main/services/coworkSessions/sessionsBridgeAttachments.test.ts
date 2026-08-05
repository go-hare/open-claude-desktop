import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getBridgePendingUploadsDir,
  materializeBridgeAttachments,
  parseBridgeFileAttachments,
  prefixBridgeMessageWithAttachmentPaths,
  safeBridgeAttachmentFileName,
} from "./sessionsBridgeAttachments";

describe("sessionsBridgeAttachments residual (j9i/$9i/W9i/Z9i)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  it("parseBridgeFileAttachments (j9i) requires file_uuid+file_name", () => {
    expect(parseBridgeFileAttachments(null)).toEqual([]);
    expect(parseBridgeFileAttachments({})).toEqual([]);
    expect(
      parseBridgeFileAttachments({
        file_attachments: [
          { file_uuid: "u1", file_name: "a.pdf" },
          { file_uuid: "bad" },
          { file_name: "no-uuid.txt" },
          { file_uuid: "u2", file_name: "b.png", is_image: true },
        ],
      }),
    ).toEqual([
      { file_uuid: "u1", file_name: "a.pdf", is_image: false },
      { file_uuid: "u2", file_name: "b.png", is_image: true },
    ]);
  });

  it("safeBridgeAttachmentFileName ($9i)", () => {
    expect(safeBridgeAttachmentFileName("/tmp/weird name!!!.txt")).toBe(
      "weird_name___.txt",
    );
    expect(safeBridgeAttachmentFileName("")).toBe("attachment");
  });

  it("prefixBridgeMessageWithAttachmentPaths residual", () => {
    expect(prefixBridgeMessageWithAttachmentPaths("hi", [])).toBe("hi");
    expect(
      prefixBridgeMessageWithAttachmentPaths("hi", ["/a/x", "/b/y"]),
    ).toBe('@"/a/x" @"/b/y" hi');
  });

  it("materializeBridgeAttachments (Z9i) downloads and returns paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-att-"));
    roots.push(root);
    const dir = getBridgePendingUploadsDir(root);
    const downloadToFile = vi.fn(async (_url, dest) => {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, "bytes");
    });
    const paths = await materializeBridgeAttachments(
      [{ file_uuid: "abcdef12-xxxx", file_name: "note.txt" }],
      {
        apiHost: "https://api.example.com",
        orgUuid: "org-1",
        getAccessToken: async () => "tok",
        pendingUploadsDir: dir,
        downloadToFile,
      },
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("abcdef12-note.txt");
    expect(downloadToFile).toHaveBeenCalledWith(
      "https://api.example.com/api/organizations/org-1/files/abcdef12-xxxx/contents",
      paths[0],
      "tok",
    );
    expect(fs.existsSync(paths[0]!)).toBe(true);
  });

  it("materialize soft-fails per file (no invent path)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-att-fail-"));
    roots.push(root);
    const dir = getBridgePendingUploadsDir(root);
    const paths = await materializeBridgeAttachments(
      [
        { file_uuid: "okuuid01", file_name: "a.txt" },
        { file_uuid: "baduuid02", file_name: "b.txt" },
      ],
      {
        apiHost: "https://api.example.com",
        orgUuid: "org",
        getAccessToken: async () => "tok",
        pendingUploadsDir: dir,
        downloadToFile: async (url, dest) => {
          // uuid8 = first 8 of file_uuid → "baduuid0" for "baduuid02"
          if (String(url).includes("baduuid02") || String(dest).includes("baduuid0-")) {
            throw new Error("HTTP 404");
          }
          await fs.promises.mkdir(path.dirname(dest), { recursive: true });
          await fs.promises.writeFile(dest, "ok");
        },
      },
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("okuuid01");
  });

  it("empty attachments → [] without download", async () => {
    const downloadToFile = vi.fn();
    const paths = await materializeBridgeAttachments([], {
      apiHost: "https://api.example.com",
      orgUuid: "org",
      getAccessToken: async () => "tok",
      downloadToFile,
    });
    expect(paths).toEqual([]);
    expect(downloadToFile).not.toHaveBeenCalled();
  });
});
