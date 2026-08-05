/**
 * Official h9e residual (app.asar):
 *   async function h9e(result, ctx) {
 *     if (result.isError) return;
 *     const image = result.content.find(c => c.type === "image");
 *     if (image) {
 *       const path = await ctx.persistScreenshotForDispatch?.(image.data, image.mimeType);
 *       if (path) result.content.unshift({ type:"text",
 *         text: `Screenshot saved to: ${path} Include this path in your response so it can be attached for the user.` });
 *     }
 *   }
 *   Called from JQe when (tool==="screenshot"||"zoom") && save_to_disk===true
 *     && persistScreenshotForDispatch is set.
 *
 * Product host-loop: write under session outputsDir as screenshot-<ts>.(png|jpg).
 * Never invents a path when outputs dir / write fails.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PersistScreenshotForDispatch = (
  dataBase64: string,
  mimeType: string,
) => Promise<string | undefined>;

/**
 * Official persistScreenshotForDispatchChild write residual (host-loop path only):
 *   join(outputsDir, `screenshot-${Date.now()}.${ext}`)
 *   rm force + writeFile flag wx with base64 buffer
 */
export async function writeScreenshotToOutputsDir(
  outputsDir: string,
  dataBase64: string,
  mimeType: string,
): Promise<string | undefined> {
  if (!outputsDir || typeof dataBase64 !== "string" || !dataBase64) {
    return undefined;
  }
  const subtype = (mimeType.split("/")[1] ?? "png").toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype || "png";
  const target = join(outputsDir, `screenshot-${Date.now()}.${ext}`);
  try {
    await mkdir(outputsDir, { recursive: true, mode: 0o700 });
    await rm(target, { force: true });
    await writeFile(target, Buffer.from(dataBase64, "base64"), { flag: "wx" });
    return target;
  } catch (error) {
    console.warn(
      "[computer-use] persist screenshot failed",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

export type McpToolResultLike = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

/**
 * Official h9e: unshift "Screenshot saved to: …" when image present and persist succeeds.
 * Mutates result.content in place (residual).
 */
export async function applySaveToDiskScreenshotNote(
  result: McpToolResultLike,
  persist: PersistScreenshotForDispatch | undefined,
): Promise<void> {
  if (!persist || result.isError) return;
  const image = result.content.find((c) => c.type === "image");
  if (!image || image.type !== "image" || typeof image.data !== "string") {
    return;
  }
  try {
    const path = await persist(image.data, image.mimeType ?? "image/png");
    if (path) {
      result.content.unshift({
        type: "text",
        text: `Screenshot saved to: ${path} Include this path in your response so it can be attached for the user.`,
      });
    }
  } catch (error) {
    console.warn(
      `[computer-use] Failed to persist screenshot to disk: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
