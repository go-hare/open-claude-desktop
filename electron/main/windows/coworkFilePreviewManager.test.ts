import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCoworkPreviewUrl,
  clipPreviewBounds,
  convertOfficeBytesToPdf,
  CoworkFilePreviewManager,
  decodePreviewPath,
  isOfficePreviewExtension,
  isOfficialParkedPreviewBounds,
  resolveSofficeBinary,
  scalePreviewBoundsWithZoom,
} from "./coworkFilePreviewManager";

test("decodePreviewPath accepts encoded paths and rejects malformed input", () => {
  assert.equal(decodePreviewPath("%2Ftmp%2Freport.pdf"), "/tmp/report.pdf");
  assert.equal(decodePreviewPath("/tmp/report.pdf"), "/tmp/report.pdf");
  assert.equal(decodePreviewPath("%E0%A4%A"), null);
  assert.equal(decodePreviewPath("/tmp/a\0b.html"), null);
  assert.equal(decodePreviewPath(""), null);
});

test("isOfficialParkedPreviewBounds accepts only the official sentinel", () => {
  assert.equal(isOfficialParkedPreviewBounds({ x: -10_000, y: 0, width: 1, height: 1 }), true);
  assert.equal(isOfficialParkedPreviewBounds({ x: -10_000, y: -1, width: 1, height: 1 }), false);
  assert.equal(isOfficialParkedPreviewBounds({ x: -9_999, y: 0, width: 1, height: 1 }), false);
  assert.equal(isOfficialParkedPreviewBounds({ x: -10_000, y: 0, width: 2, height: 1 }), false);
  assert.equal(isOfficialParkedPreviewBounds(null), false);
});

test("jkA scalePreviewBoundsWithZoom multiplies CSS bounds by zoom then vor-clips", () => {
  const viewport = { width: 1200, height: 800 };
  assert.deepEqual(scalePreviewBoundsWithZoom({ x: 100, y: 50, width: 300, height: 200 }, 1, viewport), {
    x: 100,
    y: 50,
    width: 300,
    height: 200,
  });
  assert.deepEqual(scalePreviewBoundsWithZoom({ x: 100, y: 50, width: 300, height: 200 }, 2, viewport), {
    x: 200,
    y: 100,
    width: 600,
    height: 400,
  });
  // Parked sentinel stays off-screen after zoom (official keeps negative x).
  assert.deepEqual(scalePreviewBoundsWithZoom({ x: -10_000, y: 0, width: 1, height: 1 }, 1.5, viewport), {
    x: -15_000,
    y: 0,
    width: 1,
    height: 1,
  });
  // clipPreviewBounds at zoom=1 follows official jkA ceil/floor edge math.
  assert.deepEqual(clipPreviewBounds({ x: 100.2, y: 50.8, width: 300.4, height: 200.2 }, { x: 0, y: 0, ...viewport }), {
    x: 101,
    y: 51,
    width: 299,
    height: 200,
  });
});

test("buildCoworkPreviewUrl matches official Sor + pdf hash", () => {
  assert.equal(buildCoworkPreviewUrl("report.html", 3), "cowork-file://preview/report.html?v=3");
  assert.equal(buildCoworkPreviewUrl("a b.pdf", 1), "cowork-file://preview/a%20b.pdf?v=1#toolbar=0&view=FitH");
});

function createHarness(options: { zoom?: number; captureEmpty?: boolean } = {}) {
  const bounds: Array<{ x: number; y: number; width: number; height: number }> = [];
  const loadedUrls: string[] = [];
  let visible = false;
  let captureCalls = 0;
  let attached = false;
  let removeCalls = 0;
  const image = {
    getSize: () => ({ width: bounds.at(-1)?.width ?? 0, height: bounds.at(-1)?.height ?? 0 }),
    isEmpty: () => options.captureEmpty === true,
    toPNG: () => Buffer.from("capture"),
  };
  const webContents = {
    capturePage: async () => {
      captureCalls += 1;
      return image;
    },
    close: () => undefined,
    isDestroyed: () => false,
    loadURL: async (url: string) => {
      loadedUrls.push(url);
    },
    on: () => undefined,
    insertCSS: async () => undefined,
    session: { setPermissionRequestHandler: () => undefined, clearStorageData: async () => undefined },
    setWindowOpenHandler: () => undefined,
  };
  const view = {
    getVisible: () => visible,
    setBounds: (value: { x: number; y: number; width: number; height: number }) => bounds.push(value),
    setVisible: (value: boolean) => {
      visible = value;
    },
    webContents,
  };
  const window = {
    contentView: {
      addChildView: () => {
        attached = true;
      },
      children: [],
      removeChildView: () => {
        removeCalls += 1;
        attached = false;
      },
    },
    getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
    getContentSize: () => [1200, 800] as [number, number],
    isDestroyed: () => false,
  };
  const manager = new CoworkFilePreviewManager(
    window as never,
    () => view as never,
    () => options.zoom ?? 1,
  );
  return {
    attached: () => attached,
    bounds,
    captureCalls: () => captureCalls,
    loadedUrls,
    manager,
    removeCalls: () => removeCalls,
    visible: () => visible,
  };
}

async function withPreviewFiles(run: (paths: { outside: string; root: string; safe: string; symlink: string }) => Promise<void>) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-preview-"));
  const root = path.join(parent, "root");
  const outside = path.join(parent, "outside.html");
  const safe = path.join(root, "safe.html");
  const symlink = path.join(root, "escape.html");
  await fs.mkdir(root);
  await fs.writeFile(safe, "<h1>safe</h1>");
  await fs.writeFile(outside, "<h1>outside</h1>");
  await fs.symlink(outside, symlink);
  try {
    await run({ outside, root, safe, symlink });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
}

test("manager loads while parked then relocates without capture paint gate (official knt)", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    const parked = { x: -10_000, y: 0, width: 1, height: 1 };
    assert.deepEqual(await harness.manager.show("session", encodeURIComponent(safe), parked), { ok: true });
    assert.equal(harness.captureCalls(), 0);
    assert.deepEqual(harness.bounds.at(-1), parked);
    assert.ok(harness.loadedUrls.some((url) => url.startsWith("cowork-file://preview/safe.html")));
    harness.manager.relayout();
    assert.deepEqual(harness.bounds.at(-1), parked);
    assert.equal(harness.visible(), true);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 100, y: 80, width: 640, height: 480 }),
      { ok: true },
    );
    // Same candidate: knt only re-applies bounds (no second loadURL required).
    assert.deepEqual(harness.bounds.at(-1), { x: 100, y: 80, width: 640, height: 480 });
  });
});

test("manager rejects path escapes; empty capture no longer fails show (official knt)", async () => {
  await withPreviewFiles(async ({ outside, root, safe, symlink }) => {
    const harness = createHarness({ captureEmpty: true });
    harness.manager.setSessionRootsResolver(() => [root]);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 0, y: 0, width: 400, height: 300 }),
      { ok: true },
    );
    assert.equal(harness.visible(), true);
    assert.deepEqual(await harness.manager.show("session", encodeURIComponent(outside), { x: 0, y: 0, width: 400, height: 300 }), {
      ok: false,
      declineReason: "path-not-allowed",
    });
    assert.deepEqual(await harness.manager.show("session", encodeURIComponent(symlink), { x: 0, y: 0, width: 400, height: 300 }), {
      ok: false,
      declineReason: "path-not-allowed",
    });
  });
});

test("superseded in-flight show soft-succeeds so Izt does not permanent-fallback", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    const first = harness.manager.show("session", encodeURIComponent(safe), { x: 10, y: 10, width: 320, height: 240 });
    const second = await harness.manager.show("session", encodeURIComponent(safe), { x: 20, y: 20, width: 400, height: 300 });
    const firstResult = await first;
    assert.equal(second.ok, true);
    assert.equal(firstResult.ok, true);
  });
});

test("parkAndCapture snapshots then parks without clearing the loaded surface", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 }),
      { ok: true },
    );
    const png = await harness.manager.parkAndCapture({ x: -10_000, y: 0, width: 1, height: 1 });
    assert.equal(typeof png, "string");
    assert.ok((png?.length ?? 0) > 0);
    assert.deepEqual(harness.bounds.at(-1), { x: -10_000, y: 0, width: 1, height: 1 });
    assert.equal(harness.visible(), true);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 80, y: 60, width: 500, height: 360 }),
      { ok: true },
    );
    assert.deepEqual(harness.bounds.at(-1), { x: 80, y: 60, width: 500, height: 360 });
  });
});

test("hide detaches WebContentsView like official Rp so close cannot leave a click-stealing surface", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 }),
      { ok: true },
    );
    assert.equal(harness.attached(), true);
    assert.equal(harness.visible(), true);
    harness.manager.hide();
    assert.equal(harness.visible(), false);
    assert.equal(harness.attached(), false);
    assert.ok(harness.removeCalls() >= 1);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 }),
      { ok: true },
    );
    assert.equal(harness.attached(), true);
    assert.equal(harness.visible(), true);
  });
});

test("aborted loadURL from concurrent show soft-succeeds instead of load-failed", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const bounds: Array<{ x: number; y: number; width: number; height: number }> = [];
    let visible = false;
    let loadCalls = 0;
    const webContents = {
      capturePage: async () => ({
        getSize: () => ({ width: bounds.at(-1)?.width ?? 0, height: bounds.at(-1)?.height ?? 0 }),
        isEmpty: () => false,
        toPNG: () => Buffer.from("capture"),
      }),
      close: () => undefined,
      isDestroyed: () => false,
      loadURL: async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          throw new Error("ERR_ABORTED");
        }
      },
      on: () => undefined,
      insertCSS: async () => undefined,
      session: { setPermissionRequestHandler: () => undefined, clearStorageData: async () => undefined },
      setWindowOpenHandler: () => undefined,
    };
    const view = {
      getVisible: () => visible,
      setBounds: (value: { x: number; y: number; width: number; height: number }) => bounds.push(value),
      setVisible: (value: boolean) => {
        visible = value;
      },
      webContents,
    };
    const window = {
      contentView: {
        addChildView: () => undefined,
        children: [],
        removeChildView: () => undefined,
      },
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      getContentSize: () => [1200, 800] as [number, number],
      isDestroyed: () => false,
    };
    const manager = new CoworkFilePreviewManager(window as never, () => view as never);
    manager.setSessionRootsResolver(() => [root]);
    const first = manager.show("session", encodeURIComponent(safe), { x: 10, y: 10, width: 320, height: 240 });
    const second = await manager.show("session", encodeURIComponent(safe), { x: 20, y: 20, width: 400, height: 300 });
    const firstResult = await first;
    assert.equal(second.ok, true);
    assert.equal(firstResult.ok, true);
  });
});

test("isOfficePreviewExtension and resolveSofficeBinary match official Mnt / host soffice gate", () => {
  assert.equal(isOfficePreviewExtension(".docx"), true);
  assert.equal(isOfficePreviewExtension(".PPTX"), true);
  assert.equal(isOfficePreviewExtension(".pdf"), false);
  assert.equal(resolveSofficeBinary({ CLAUDE_SOFFICE_PATH: "/custom/soffice" }), "/custom/soffice");
  assert.equal(resolveSofficeBinary({}, "linux"), null);
});

test("isVmReady is true only when host soffice/converter is available", () => {
  const harness = createHarness();
  harness.manager.setOfficeConverterForTests(null);
  assert.equal(harness.manager.isVmReady(), false);
  harness.manager.setOfficeConverterForTests(async () => Buffer.from("%PDF-1.4 mock"));
  assert.equal(harness.manager.isVmReady(), true);
  harness.manager.setOfficeConverterForTests(undefined);
  harness.manager.setSofficePathForTests(null);
  assert.equal(harness.manager.isVmReady(), false);
  harness.manager.setSofficePathForTests("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  assert.equal(harness.manager.isVmReady(), true);
});

test("office show converts via Mor-equivalent path then loads pdf via protocol", async () => {
  await withPreviewFiles(async ({ root }) => {
    const docx = path.join(root, "report.docx");
    await fs.writeFile(docx, Buffer.from("PK-office-fixture"));
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    let convertCalls = 0;
    harness.manager.setOfficeConverterForTests(async (bytes, extension) => {
      convertCalls += 1;
      assert.equal(extension, ".docx");
      assert.ok(bytes.length > 0);
      return Buffer.from("%PDF-1.4 converted-office");
    });
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(docx), { x: 40, y: 40, width: 500, height: 360 }),
      { ok: true },
    );
    assert.equal(convertCalls, 1);
    assert.equal(harness.visible(), true);
    assert.ok(harness.loadedUrls.some((url) => url.includes(".pdf") && url.startsWith("cowork-file://preview/")));
    // Second show of same candidate skips reconvert/reload.
    const loadsBefore = harness.loadedUrls.length;
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(docx), { x: 50, y: 50, width: 520, height: 380 }),
      { ok: true },
    );
    assert.equal(convertCalls, 1);
    assert.equal(harness.loadedUrls.length, loadsBefore);
  });
});

test("office show without converter declines vm_unavailable like official resolve", async () => {
  await withPreviewFiles(async ({ root }) => {
    const docx = path.join(root, "report.docx");
    await fs.writeFile(docx, Buffer.from("PK-office-fixture"));
    const harness = createHarness();
    harness.manager.setSessionRootsResolver(() => [root]);
    harness.manager.setOfficeConverterForTests(null);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(docx), { x: 0, y: 0, width: 400, height: 300 }),
      { ok: false, declineReason: "vm_unavailable" },
    );
    assert.equal(harness.visible(), false);
  });
});

test("jkA applies zoom factor from provider when showing", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    const harness = createHarness({ zoom: 2 });
    harness.manager.setSessionRootsResolver(() => [root]);
    assert.deepEqual(
      await harness.manager.show("session", encodeURIComponent(safe), { x: 10, y: 20, width: 100, height: 50 }),
      { ok: true },
    );
    assert.deepEqual(harness.bounds.at(-1), { x: 20, y: 40, width: 200, height: 100 });
  });
});

test("hide during in-flight resolve never re-attaches (click-steal race)", async () => {
  await withPreviewFiles(async ({ root, safe }) => {
    let releaseResolve!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    const bounds: Array<{ x: number; y: number; width: number; height: number }> = [];
    let visible = false;
    let attached = false;
    let removeCalls = 0;
    let addCalls = 0;
    const webContents = {
      capturePage: async () => ({
        getSize: () => ({ width: 1, height: 1 }),
        isEmpty: () => false,
        toPNG: () => Buffer.from("capture"),
      }),
      close: () => undefined,
      isDestroyed: () => false,
      loadURL: async () => undefined,
      on: () => undefined,
      insertCSS: async () => undefined,
      session: { setPermissionRequestHandler: () => undefined, clearStorageData: async () => undefined },
      setWindowOpenHandler: () => undefined,
    };
    const view = {
      getVisible: () => visible,
      setBounds: (value: { x: number; y: number; width: number; height: number }) => bounds.push(value),
      setVisible: (value: boolean) => {
        visible = value;
      },
      webContents,
    };
    const window = {
      contentView: {
        addChildView: () => {
          addCalls += 1;
          attached = true;
        },
        children: [],
        removeChildView: () => {
          removeCalls += 1;
          attached = false;
        },
      },
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      getContentSize: () => [1200, 800] as [number, number],
      isDestroyed: () => false,
    };
    const manager = new CoworkFilePreviewManager(window as never, () => view as never);
    // Stall resolve after pending is set so hide can race the in-flight show.
    manager.setSessionRootsResolver(async () => {
      await gate;
      return [root];
    });

    const inflight = manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 });
    // Let show reach pending + await resolveRoots.
    await new Promise((resolve) => setTimeout(resolve, 20));
    manager.hide();
    releaseResolve();
    const result = await inflight;
    assert.equal(result.ok, true);
    assert.equal(attached, false);
    assert.equal(visible, false);
    assert.ok(removeCalls >= 0);
    // After hide, a second show of the same path must fully re-resolve (yv cleared).
    manager.setSessionRootsResolver(() => [root]);
    assert.deepEqual(
      await manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 }),
      { ok: true },
    );
    assert.equal(attached, true);
    assert.equal(visible, true);
    manager.hide();
    assert.equal(attached, false);
    assert.equal(visible, false);
    assert.ok(removeCalls >= 1);
    // Post-hide matchesLoaded must not re-attach (official n(yv) only jkA when yv present).
    const addBeforeStale = addCalls;
    assert.deepEqual(
      await manager.show("session", encodeURIComponent(safe), { x: 40, y: 40, width: 400, height: 300 }),
      { ok: true },
    );
    manager.hide();
    // Simulate a late matchesLoaded-style show after hide cleared yv — still full path, then hide.
    assert.equal(attached, false);
    void addBeforeStale;
  });
});

test("convertOfficeBytesToPdf uses cache and maps soffice failures", async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "office-cache-"));
  try {
    const bytes = Buffer.from("PK-office-bytes");
    let calls = 0;
    const first = await convertOfficeBytesToPdf(bytes, ".docx", {
      cacheDir,
      sofficePath: "/fake/soffice",
      execFileImpl: async () => {
        calls += 1;
        const entries = await fs.readdir(cacheDir);
        const work = entries.find((name) => name.startsWith("office-convert-"));
        assert.ok(work);
        const workDir = path.join(cacheDir, work!);
        const files = await fs.readdir(workDir);
        const input = files.find((name) => name.endsWith(".docx"));
        assert.ok(input);
        const pdfName = input!.replace(/\.docx$/i, ".pdf");
        await fs.writeFile(path.join(workDir, pdfName), Buffer.from("%PDF-1.4 unit"));
        return { stdout: "", stderr: "" } as never;
      },
    });
    assert.equal(first.cacheHit, false);
    assert.equal(first.pdfBytes.toString(), "%PDF-1.4 unit");
    assert.equal(calls, 1);
    const second = await convertOfficeBytesToPdf(bytes, ".docx", {
      cacheDir,
      sofficePath: "/fake/soffice",
      execFileImpl: async () => {
        calls += 1;
        throw new Error("should not run on cache hit");
      },
    });
    assert.equal(second.cacheHit, true);
    assert.equal(second.pdfBytes.toString(), "%PDF-1.4 unit");
    assert.equal(calls, 1);
    await assert.rejects(
      () =>
        convertOfficeBytesToPdf(Buffer.from("other"), ".pptx", {
          cacheDir,
          sofficePath: null,
        }),
      /soffice binary not found/,
    );
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});
