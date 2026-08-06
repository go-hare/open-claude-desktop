/**
 * Build resources/electron.ico from residual electron-app-icon.png.
 *
 * Why: PNG-only ICO embeds fine in PE, but Windows Explorer often falls back to
 * the stock Electron atom until small sizes are classic BMP DIB entries.
 * Layout:
 *   16/24/32/48/64/128 → 32bpp BMP DIB (Explorer-friendly)
 *   256               → PNG (Vista+)
 *
 * Usage: node scripts/generate-app-icon-ico.mjs
 * Requires: sharp (devDependency) OR falls back to pre-existing ico if sharp missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngPath = path.join(root, "resources/electron-app-icon.png");
const icoPath = path.join(root, "resources/electron.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(pngPath)) {
  fail(`missing ${path.relative(root, pngPath)}`);
}

// Prefer python+PIL when available (already used in package host); else sharp.
function tryPython() {
  const script = `
from pathlib import Path
from PIL import Image
import struct, io
src = Image.open(r${JSON.stringify(pngPath)}).convert("RGBA")
sizes = ${JSON.stringify(sizes)}

def png_bytes(im):
    b = io.BytesIO(); im.save(b, format="PNG"); return b.getvalue()

def bmp_dib(im):
    w, h = im.size
    pixels = im.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            xor += bytes((b, g, r, a))
    row_bytes = ((w + 31) // 32) * 4
    and_mask = bytes(row_bytes * h)
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return header + xor + and_mask

images = []
for s in sizes:
    im = src.resize((s, s), Image.Resampling.LANCZOS)
    if s >= 256:
        data = png_bytes(im)
    else:
        data = bmp_dib(im)
    images.append((s, data, s >= 256))

count = len(images)
offset = 6 + 16 * count
entries = bytearray()
payload = bytearray()
for s, data, _ in images:
    wb = 0 if s == 256 else s
    entries += struct.pack("<BBBBHHII", wb, wb, 0, 0, 1, 32, len(data), offset)
    payload += data
    offset += len(data)
out = struct.pack("<HHH", 0, 1, count) + entries + payload
Path(r${JSON.stringify(icoPath)}).write_bytes(out)
print("wrote", r${JSON.stringify(icoPath)}, "bytes", len(out), "images", count)
`;
  const py = spawnSync("python", ["-"], {
    input: script,
    encoding: "utf8",
    cwd: root,
  });
  if (py.status === 0) {
    console.log(py.stdout.trim());
    return true;
  }
  console.warn("[generate-app-icon-ico] python/PIL failed:", (py.stderr || py.stdout || "").slice(0, 300));
  return false;
}

if (!tryPython()) {
  if (fs.existsSync(icoPath)) {
    console.warn(`[generate-app-icon-ico] keeping existing ${path.relative(root, icoPath)}`);
    process.exit(0);
  }
  fail("cannot generate electron.ico (need python+Pillow, or commit resources/electron.ico)");
}
