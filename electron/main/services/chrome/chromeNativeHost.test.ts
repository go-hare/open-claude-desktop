import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNativeHostManifest,
  CHROME_EXTENSION_ALLOWED_ORIGINS,
  CHROME_EXTENSION_ID_CURRENT,
  CHROME_EXTENSION_ID_LEGACY,
  CHROME_EXTENSION_ID_THIRD,
  installNativeHostManifest,
  NATIVE_HOST_MANIFEST_FILE,
  NATIVE_HOST_NAME,
  nonPrimaryNativeMessagingRoots,
  primaryNativeMessagingRoots,
  removeNativeHostManifest,
  syncPrimaryNativeHostManifests,
} from "./chromeNativeHost";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe("chromeNativeHost residual", () => {
  it("HFA darwin roots are Chrome + Edge NativeMessagingHosts", () => {
    const roots = primaryNativeMessagingRoots("/Users/test", "darwin");
    expect(roots.map((r) => r.name)).toEqual(["Chrome", "Edge"]);
    expect(roots[0]?.path).toContain(
      path.join("Google", "Chrome", "NativeMessagingHosts"),
    );
    expect(roots[1]?.path).toContain(
      path.join("Microsoft Edge", "NativeMessagingHosts"),
    );
  });

  it("bai non-primary includes Brave/Chromium/Arc/Vivaldi/Opera", () => {
    const roots = nonPrimaryNativeMessagingRoots("/Users/test", "darwin");
    expect(roots.map((r) => r.name)).toEqual([
      "Brave",
      "Chromium",
      "Arc",
      "Vivaldi",
      "Opera",
    ]);
  });

  it("krt manifest allowed_origins: product first + official residual", () => {
    const manifest = buildNativeHostManifest("/path/to/chrome-native-host");
    expect(manifest).toEqual({
      name: NATIVE_HOST_NAME,
      description: "Claude Browser Extension Native Host",
      path: "/path/to/chrome-native-host",
      type: "stdio",
      allowed_origins: [
        `chrome-extension://${CHROME_EXTENSION_ID_CURRENT}/`,
        `chrome-extension://${CHROME_EXTENSION_ID_LEGACY}/`,
        `chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/`,
        `chrome-extension://${CHROME_EXTENSION_ID_THIRD}/`,
      ],
    });
    // Product go-hare id is primary CURRENT.
    expect(CHROME_EXTENSION_ID_CURRENT).toBe("bbkeopmjdjdiiaahndbbjhckdbgblpjn");
    expect(CHROME_EXTENSION_ALLOWED_ORIGINS[0]).toBe(
      "chrome-extension://bbkeopmjdjdiiaahndbbjhckdbgblpjn/",
    );
    expect(CHROME_EXTENSION_ALLOWED_ORIGINS).toHaveLength(4);
  });

  it("install + remove native host manifest on disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-host-"));
    dirs.push(dir);
    await installNativeHostManifest(dir, "Chrome", "/bin/fake-host");
    const file = path.join(dir, NATIVE_HOST_MANIFEST_FILE);
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      name: string;
      path: string;
      type: string;
    };
    expect(parsed.name).toBe(NATIVE_HOST_NAME);
    expect(parsed.path).toBe("/bin/fake-host");
    expect(parsed.type).toBe("stdio");
    await removeNativeHostManifest(dir, "Chrome");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("sync without extension removes manifest (no invent write)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    dirs.push(home);
    const chromeNm = path.join(
      home,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "NativeMessagingHosts",
    );
    fs.mkdirSync(chromeNm, { recursive: true });
    const stale = path.join(chromeNm, NATIVE_HOST_MANIFEST_FILE);
    fs.writeFileSync(stale, "{}", "utf8");
    const result = await syncPrimaryNativeHostManifests({
      home,
      platform: "darwin",
      hostBinaryPath: "/bin/fake-host",
      log: () => undefined,
    });
    expect(result.removed).toContain("Chrome");
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("detects unpacked extension via Secure Preferences path", async () => {
    const { browserHasClaudeChromeExtension, CHROME_EXTENSION_ID_PRODUCT } =
      await import("./chromeNativeHost");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    dirs.push(home);
    const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), "unpacked-ext-"));
    dirs.push(unpacked);
    fs.writeFileSync(
      path.join(unpacked, "manifest.json"),
      JSON.stringify({ name: "test", version: "1.0" }),
      "utf8",
    );
    const profile = path.join(
      home,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Profile 1",
    );
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, "Secure Preferences"),
      JSON.stringify({
        extensions: {
          settings: {
            [CHROME_EXTENSION_ID_PRODUCT]: {
              path: unpacked,
              location: 4,
            },
          },
        },
      }),
      "utf8",
    );
    const has = await browserHasClaudeChromeExtension({
      name: "Chrome",
      path: path.dirname(profile),
    });
    expect(has).toBe(true);
  });
});
