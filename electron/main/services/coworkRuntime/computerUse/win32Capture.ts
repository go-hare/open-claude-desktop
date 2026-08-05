/**
 * Official Win residual screenshot path (app.asar createWin32Executor helpers):
 *   contentProtection → desktopCapturer → optional mask rects → JPEG resize.
 * Anchors: GQe / LQe / WUi / vQe / zZe / bQe / zUi / WZe / MoA / TQe.
 */
import {
  BrowserWindow,
  desktopCapturer,
  nativeImage,
  screen,
  type Display,
  type NativeImage,
} from "electron";
import {
  API_RESIZE_PARAMS,
  targetImageSize,
} from "@ant/computer-use-mcp";
import { maybeGetClaudeNative } from "./claudeNative";

const CAPTURE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 100;
const CONTENT_PROTECTION_SETTLE_MS = 50;
const JPEG_QUALITY = 75;
/** Residual $Ui — mask fill BGRA dark gray. */
const MASK_PIXEL = Buffer.from([30, 30, 30, 255]);

export type CaptureRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CapturedFrame = {
  base64: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  displayId: number;
  originX: number;
  originY: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidJpeg(buf: Buffer): boolean {
  return (
    buf.length > 4 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[buf.length - 2] === 0xff &&
    buf[buf.length - 1] === 0xd9
  );
}

/** Residual MoA — DIP bounds → physical pixels. */
export function displayPhysicalBounds(display: Display): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const physical = screen.dipToScreenRect(null, display.bounds);
  return {
    x: Math.round(physical.x),
    y: Math.round(physical.y),
    width: Math.round(physical.width),
    height: Math.round(physical.height),
  };
}

export function resolveDisplay(displayId?: number): Display {
  if (displayId === undefined) return screen.getPrimaryDisplay();
  return (
    screen.getAllDisplays().find((d) => d.id === displayId) ??
    screen.getPrimaryDisplay()
  );
}

/** Residual TQe */
export function listDisplayGeometries() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => {
    const physical = displayPhysicalBounds(display);
    return {
      displayId: display.id,
      width: physical.width,
      height: physical.height,
      scaleFactor: display.scaleFactor,
      originX: physical.x,
      originY: physical.y,
      isPrimary: display.id === primaryId,
      label:
        display.label ||
        (display.id === primaryId ? "Built-in Display" : undefined),
    };
  });
}

/**
 * Residual jUi — map native cu displayId (from cuDisplayForPid) to Electron display id.
 */
export function mapNativeDisplayIdToElectron(
  nativeDisplayId: number,
): number | null {
  const native = maybeGetClaudeNative();
  if (!native) return null;
  const entry = native.cuListDisplays().find((d) => d.displayId === nativeDisplayId);
  if (!entry) return null;
  const match = screen.getAllDisplays().find((display) => {
    const physical = displayPhysicalBounds(display);
    return physical.x === entry.originX && physical.y === entry.originY;
  });
  return match?.id ?? null;
}

/** Residual WZe — hide host windows from capture via content protection. */
async function withContentProtection<T>(fn: () => Promise<T>): Promise<T> {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const alwaysOnTop = new Map<number, boolean>();
  for (const win of windows) {
    alwaysOnTop.set(win.id, win.isAlwaysOnTop());
    win.setContentProtection(true);
  }
  await delay(CONTENT_PROTECTION_SETTLE_MS);
  try {
    return await fn();
  } finally {
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      win.setContentProtection(false);
      if (alwaysOnTop.get(win.id) && !win.isAlwaysOnTop()) {
        win.setAlwaysOnTop(true, "screen-saver");
      }
    }
  }
}

/** Residual GQe */
async function captureRawThumbnail(display: Display): Promise<NativeImage> {
  const physical = displayPhysicalBounds(display);
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  const source =
    sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) {
    throw new Error("desktopCapturer returned no screen sources");
  }
  // Prefer physical size from display when thumbnail size mismatches.
  void physical;
  return source.thumbnail;
}

/** Residual WUi — fill excluded rects with mask color in BGRA bitmap. */
function maskBitmap(
  bitmap: Buffer,
  width: number,
  height: number,
  rects: CaptureRect[],
): void {
  const stride = width * 4;
  const rowCache = new Map<number, Buffer>();
  for (const rect of rects) {
    const left = Math.max(0, Math.min(width, rect.left));
    const top = Math.max(0, Math.min(height, rect.top));
    const right = Math.max(0, Math.min(width, rect.left + rect.width));
    const bottom = Math.max(0, Math.min(height, rect.top + rect.height));
    const span = right - left;
    if (span <= 0 || bottom <= top) continue;
    let row = rowCache.get(span);
    if (!row) {
      row = Buffer.alloc(span * 4);
      for (let i = 0; i < row.length; i += 4) MASK_PIXEL.copy(row, i);
      rowCache.set(span, row);
    }
    const offset = left * 4;
    for (let y = top; y < bottom; y++) {
      row.copy(bitmap, y * stride + offset);
    }
  }
}

/** Residual vQe — denied bundle window rects in display-local physical coords. */
export function excludedRectsForDisplay(
  deniedBundleIds: string[],
  display: Display,
): CaptureRect[] {
  if (deniedBundleIds.length === 0) return [];
  const native = maybeGetClaudeNative();
  if (!native?.cuExcludedWindowRects) return [];
  const { x, y, width, height } = displayPhysicalBounds(display);
  const out: CaptureRect[] = [];
  for (const rect of native.cuExcludedWindowRects(deniedBundleIds)) {
    const left = Math.max(0, rect.x - x);
    const top = Math.max(0, rect.y - y);
    const right = Math.min(width, rect.x + rect.width - x);
    const bottom = Math.min(height, rect.y + rect.height - y);
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) continue;
    out.push({ left, top, width: w, height: h });
  }
  return out;
}

function mergeRects(...groups: CaptureRect[][]): CaptureRect[] {
  const seen = new Set<string>();
  const out: CaptureRect[] = [];
  for (const group of groups) {
    for (const rect of group) {
      const key = `${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rect);
    }
  }
  return out;
}

/** Residual LQe */
function encodeMaskedJpeg(
  image: NativeImage,
  rects: CaptureRect[],
): { buffer: Buffer; width: number; height: number } {
  let work = image;
  const { width, height } = work.getSize();
  if (rects.length > 0) {
    const bitmap = work.toBitmap();
    maskBitmap(bitmap, width, height, rects);
    work = nativeImage.createFromBitmap(bitmap, { width, height });
  }
  const [targetW, targetH] = targetImageSize(
    width,
    height,
    API_RESIZE_PARAMS,
  );
  const resized = work.resize({
    width: targetW,
    height: targetH,
    quality: "good",
  });
  const size = resized.getSize();
  return {
    buffer: resized.toJPEG(JPEG_QUALITY),
    width: size.width,
    height: size.height,
  };
}

/** Residual zZe */
async function captureWithRetries(
  display: Display,
  deniedBundleIds: string[],
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const needMask = deniedBundleIds.length > 0;
  let lastError: unknown;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt++) {
    if (attempt > 1) await delay(RETRY_DELAY_MS);
    try {
      if (!needMask) {
        const frame = encodeMaskedJpeg(await captureRawThumbnail(display), []);
        if (isValidJpeg(frame.buffer)) return frame;
        lastError = new Error(
          `JPEG validation failed (size=${frame.buffer.length})`,
        );
        continue;
      }
      const before = excludedRectsForDisplay(deniedBundleIds, display);
      const thumb = await captureRawThumbnail(display);
      const after = excludedRectsForDisplay(deniedBundleIds, display);
      const frame = encodeMaskedJpeg(thumb, mergeRects(before, after));
      if (isValidJpeg(frame.buffer)) return frame;
      lastError = new Error(
        `JPEG validation failed (size=${frame.buffer.length})`,
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Screenshot capture failed after ${CAPTURE_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Residual bQe */
export async function captureDisplayScreenshot(
  displayId: number | undefined,
  deniedBundleIds: string[],
): Promise<CapturedFrame> {
  const display = resolveDisplay(displayId);
  const { buffer, width, height } = await withContentProtection(() =>
    captureWithRetries(display, deniedBundleIds),
  );
  const physical = displayPhysicalBounds(display);
  return {
    base64: buffer.toString("base64"),
    width,
    height,
    displayWidth: physical.width,
    displayHeight: physical.height,
    displayId: display.id,
    originX: physical.x,
    originY: physical.y,
  };
}

/** Residual zUi — zoom/crop region in logical display coords. */
export async function captureZoomRegion(
  regionLogical: { x: number; y: number; w: number; h: number },
  displayId: number | undefined,
  deniedBundleIds: string[],
): Promise<{ base64: string; width: number; height: number }> {
  const display = resolveDisplay(displayId);
  const rx = Math.round(regionLogical.x);
  const ry = Math.round(regionLogical.y);
  const rw = Math.round(regionLogical.w);
  const rh = Math.round(regionLogical.h);
  const [targetW, targetH] = targetImageSize(rw, rh, API_RESIZE_PARAMS);
  const { buffer, width, height } = await withContentProtection(() =>
    captureWithRetries(display, deniedBundleIds),
  );
  const physical = displayPhysicalBounds(display);
  const scaleX = width / physical.width;
  const scaleY = height / physical.height;
  const cropX = Math.max(0, Math.min(width - 1, Math.round(rx * scaleX)));
  const cropY = Math.max(0, Math.min(height - 1, Math.round(ry * scaleY)));
  const cropW = Math.max(1, Math.min(width - cropX, Math.round(rw * scaleX)));
  const cropH = Math.max(1, Math.min(height - cropY, Math.round(rh * scaleY)));
  const cropped = nativeImage
    .createFromBuffer(buffer)
    .crop({ x: cropX, y: cropY, width: cropW, height: cropH })
    .resize({ width: targetW, height: targetH, quality: "good" });
  const size = cropped.getSize();
  return {
    base64: cropped.toJPEG(JPEG_QUALITY).toString("base64"),
    width: size.width,
    height: size.height,
  };
}
