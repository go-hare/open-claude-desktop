import { toLoggerDetail } from "./types.js";
const DEFAULT_GRID_SIZE = 9;
function computeCropRect(imgW, imgH, xPercent, yPercent, gridSize) {
  if (!imgW || !imgH) return null;
  const clampedX = Math.max(0, Math.min(100, xPercent));
  const clampedY = Math.max(0, Math.min(100, yPercent));
  const centerX = Math.round(clampedX / 100 * imgW);
  const centerY = Math.round(clampedY / 100 * imgH);
  const halfGrid = Math.floor(gridSize / 2);
  const cropX = Math.max(0, centerX - halfGrid);
  const cropY = Math.max(0, centerY - halfGrid);
  const cropW = Math.min(gridSize, imgW - cropX);
  const cropH = Math.min(gridSize, imgH - cropY);
  if (cropW <= 0 || cropH <= 0) return null;
  return { x: cropX, y: cropY, width: cropW, height: cropH };
}
function comparePixelAtLocation(crop, lastScreenshot, freshScreenshot, xPercent, yPercent, gridSize = DEFAULT_GRID_SIZE) {
  const rect = computeCropRect(
    freshScreenshot.width,
    freshScreenshot.height,
    xPercent,
    yPercent,
    gridSize
  );
  if (!rect) return false;
  const patch1 = crop(lastScreenshot.base64, rect);
  const patch2 = crop(freshScreenshot.base64, rect);
  if (!patch1 || !patch2) return false;
  return patch1.equals(patch2);
}
async function validateClickTarget(crop, lastScreenshot, xPercent, yPercent, takeFreshScreenshot, logger, gridSize = DEFAULT_GRID_SIZE) {
  if (!lastScreenshot) {
    return { valid: true, skipped: true };
  }
  try {
    const fresh = await takeFreshScreenshot();
    if (!fresh) {
      return { valid: true, skipped: true };
    }
    const pixelsMatch = comparePixelAtLocation(
      crop,
      lastScreenshot,
      fresh,
      xPercent,
      yPercent,
      gridSize
    );
    if (pixelsMatch) {
      return { valid: true, skipped: false };
    }
    return {
      valid: false,
      skipped: false,
      warning: "Screen content at the target location changed since the last screenshot. Take a new screenshot before clicking."
    };
  } catch (err) {
    logger.debug(
      "[pixelCompare] validation error, skipping",
      toLoggerDetail(err)
    );
    return { valid: true, skipped: true };
  }
}
export {
  comparePixelAtLocation,
  validateClickTarget
};
