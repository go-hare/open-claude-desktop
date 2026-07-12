#!/usr/bin/env node
/**
 * Real Electron host verification for CoworkFilePreviewManager.
 * Builds the manager to a temp ESM module, then exercises HTML/SVG/PDF
 * show, full-size paint, parkAndCapture, restore, and path containment.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronCli = path.join(root, "node_modules/electron/cli.js");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-preview-live-"));
const managerOut = path.join(workDir, "coworkFilePreviewManager.mjs");
const runnerOut = path.join(workDir, "runner.mjs");
const resultOut = path.join(workDir, "result.json");

await esbuild.build({
  entryPoints: [path.join(root, "electron/main/windows/coworkFilePreviewManager.ts")],
  outfile: managerOut,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  logLevel: "silent",
});

const runnerSource = `
import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CoworkFilePreviewManager } from ${JSON.stringify(pathToFileURL(managerOut).href)};

const resultOut = ${JSON.stringify(resultOut)};

async function writeResult(result) {
  await fs.writeFile(resultOut, JSON.stringify(result, null, 2));
}

async function main() {
  await app.whenReady();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cowork-preview-files-"));
  const htmlPath = path.join(dir, "sample.html");
  const svgPath = path.join(dir, "sample.svg");
  const pdfPath = path.join(dir, "sample.pdf");
  const docxPath = path.join(dir, "sample.docx");

  await fs.writeFile(
    htmlPath,
    "<!doctype html><html><body style=\\"margin:0;background:#112233;color:#ffcc00;font:48px sans-serif;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh\\"><div>HTML_PREVIEW_OK</div></body></html>",
  );
  await fs.writeFile(
    svgPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#003366"/><text x="40" y="120" fill="#00ff99" font-size="48" font-family="sans-serif">SVG_PREVIEW_OK</text></svg>',
  );
  const pdf = [
    "%PDF-1.1",
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
    "4 0 obj<< /Length 55 >>stream",
    "BT /F1 24 Tf 40 70 Td (PDF_PREVIEW_OK) Tj ET",
    "endstream endobj",
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "0000000266 00000 n ",
    "0000000371 00000 n ",
    "trailer<< /Size 6 /Root 1 0 R >>",
    "startxref",
    "448",
    "%%EOF",
  ].join("\\n");
  await fs.writeFile(pdfPath, pdf);
  // Prefer a known-good real Office fixture when present (host soffice Mor path).
  const fixtureDocx = "/Users/apple/work-py/AppAgent/cowork-native-preview-live.docx";
  try {
    await fs.copyFile(fixtureDocx, docxPath);
  } catch {
    await fs.writeFile(docxPath, Buffer.from("PK-office-not-convertible"));
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadURL("data:text/html,<html><body style='background:#ddd;margin:0'></body></html>");
  await new Promise((resolve) => setTimeout(resolve, 250));

  const manager = new CoworkFilePreviewManager(win);
  manager.setSessionRootsResolver(() => [dir]);

  const bounds = { x: 80, y: 60, width: 720, height: 520 };
  const parked = { x: -10000, y: 0, width: 1, height: 1 };
  const cases = [];

  async function checkFile(label, filePath) {
    const entry = { label, filePath, steps: {} };
    try {
      entry.steps.visibleShow = await manager.show("live-session", encodeURIComponent(filePath), bounds);
      if (entry.steps.visibleShow?.ok) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        // Capture from the preview child view, not the parent window shell.
        const child = win.contentView.children.at(-1);
        if (child?.webContents?.capturePage) {
          const image = await child.webContents.capturePage();
          const size = image.getSize();
          entry.steps.visibleCapture = {
            empty: image.isEmpty(),
            width: size.width,
            height: size.height,
            pngBytes: image.toPNG().length,
            from: "child-view",
          };
        } else {
          const image = await win.webContents.capturePage({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const size = image.getSize();
          entry.steps.visibleCapture = {
            empty: image.isEmpty(),
            width: size.width,
            height: size.height,
            pngBytes: image.toPNG().length,
            from: "window",
          };
        }
      }

      entry.steps.parkedShow = await manager.show("live-session", encodeURIComponent(filePath), parked);

      entry.steps.restoreShow = await manager.show("live-session", encodeURIComponent(filePath), bounds);
      if (entry.steps.restoreShow?.ok) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const captureB64 = await manager.parkAndCapture(parked);
        entry.steps.parkAndCapture = {
          ok: typeof captureB64 === "string" && captureB64.length > 32,
          base64Length: typeof captureB64 === "string" ? captureB64.length : 0,
        };
        entry.steps.afterParkRestore = await manager.show("live-session", encodeURIComponent(filePath), bounds);
      }

      const capture = entry.steps.visibleCapture;
      // Official knt returns { ok: true } after attach+loadURL (no painted capture gate).
      // We still require a non-empty child-view capture as a host paint smoke check.
      const scaleOk = Boolean(
        capture &&
        capture.empty === false &&
        capture.width >= 1 &&
        capture.height >= 1 &&
        capture.pngBytes > 0,
      );
      entry.ok = Boolean(
        entry.steps.visibleShow?.ok === true &&
        scaleOk &&
        entry.steps.parkedShow?.ok === true &&
        entry.steps.restoreShow?.ok === true &&
        entry.steps.parkAndCapture?.ok === true &&
        entry.steps.afterParkRestore?.ok === true,
      );
    } catch (error) {
      entry.ok = false;
      entry.error = error instanceof Error ? error.message : String(error);
    }
    cases.push(entry);
  }

  await checkFile("html", htmlPath);
  await checkFile("svg", svgPath);
  await checkFile("pdf", pdfPath);
  // Official Mor/soffice Office branch — requires host soffice (isVmReady true).
  const entryVmReady = manager.isVmReady();
  await checkFile("docx", docxPath);

  const outside = path.join(os.tmpdir(), \`outside-\${process.pid}.html\`);
  await fs.writeFile(outside, "<html><body>OUTSIDE</body></html>");
  const escapeResult = await manager.show("live-session", encodeURIComponent(outside), bounds);

  // Click-steal race: hide while resolve is still in flight must not leave a child view attached.
  // Slow path = office convert via real soffice (or converter). Use html with delayed roots for determinism.
  let releaseRoots;
  const rootsGate = new Promise((resolve) => {
    releaseRoots = resolve;
  });
  manager.setSessionRootsResolver(async () => {
    await rootsGate;
    return [dir];
  });
  const raceShow = manager.show("live-session", encodeURIComponent(htmlPath), bounds);
  await new Promise((resolve) => setTimeout(resolve, 30));
  manager.hide();
  releaseRoots();
  const raceShowResult = await raceShow;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const childrenAfterRaceHide = win.contentView.children.length;
  // After hide, no preview child should remain on the parent contentView.
  // (Shell window may have 0 children; manager uses addChildView only while attached.)
  const raceOk =
    raceShowResult?.ok === true &&
    // Official Rp: detached. Our harness starts with no children; after hide must stay 0.
    childrenAfterRaceHide === 0;

  // Clean reopen then hide: child attaches then detaches.
  manager.setSessionRootsResolver(() => [dir]);
  const reopen = await manager.show("live-session", encodeURIComponent(htmlPath), bounds);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const childrenWhileOpen = win.contentView.children.length;
  manager.hide();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const childrenAfterHide = win.contentView.children.length;
  const detachOk = reopen?.ok === true && childrenWhileOpen >= 1 && childrenAfterHide === 0;

  const result = {
    ok:
      cases.every((item) => item.ok) &&
      escapeResult.ok === false &&
      escapeResult.declineReason === "path-not-allowed" &&
      entryVmReady === true &&
      raceOk &&
      detachOk,
    cases,
    escapeResult,
    isVmReady: entryVmReady,
    race: {
      ok: raceOk,
      showResult: raceShowResult,
      childrenAfterRaceHide,
    },
    detach: {
      ok: detachOk,
      childrenWhileOpen,
      childrenAfterHide,
    },
  };

  await writeResult(result);
  manager.destroy();
  win.destroy();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outside, { force: true }).catch(() => {});
  app.exit(result.ok ? 0 : 2);
}

main().catch(async (error) => {
  await writeResult({
    ok: false,
    error: error instanceof Error ? error.stack || error.message : String(error),
  });
  app.exit(1);
});
`;

await fs.writeFile(runnerOut, runnerSource);

const child = spawn(process.execPath, [electronCli, runnerOut], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "",
    CLAUDE_USER_DATA_DIR: path.join(root, ".preview-live-user-data"),
    electron_config_cache: path.join(root, ".electron-cache"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

const code = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    resolve(124);
  }, 60000);
  child.on("exit", (exitCode) => {
    clearTimeout(timer);
    resolve(exitCode ?? 1);
  });
});

let result;
try {
  result = JSON.parse(await fs.readFile(resultOut, "utf8"));
} catch {
  result = {
    ok: false,
    error: "missing result file",
    code,
    output: output.slice(-5000),
  };
}

console.log(JSON.stringify(result, null, 2));
await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
process.exit(result.ok ? 0 : code || 1);
