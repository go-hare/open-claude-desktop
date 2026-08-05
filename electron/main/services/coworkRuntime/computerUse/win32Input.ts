/**
 * Official residual input helpers shared into createWin32Executor (eTi).
 * Anchors: eTi / sv / Zki / Wki / Hu / ATi / ule / Ha.
 */
import { BrowserWindow, clipboard } from "electron";
import {
  maybeGetClaudeNative,
  requireClaudeNative,
  type ClaudeNativeModule,
} from "./claudeNative";

const IGNORE_MOUSE_SETTLE_MS = 50;
const MOVE_SETTLE_MS = 50;
const PASTE_KEYS = ["ctrl", "v"] as const;

const ignoreMousePinned = new Set<number>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function asPromise<T>(value: T | Promise<T>): Promise<T> {
  return value;
}

function isEscapeOnly(keys: string[]): boolean {
  if (keys.length !== 1) return false;
  const k = keys[0]!.toLowerCase();
  return k === "escape" || k === "esc";
}

/** Residual Hu — ignore mouse on host windows while injecting global input. */
export async function withHostMouseIgnored<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  for (const win of windows) win.setIgnoreMouseEvents(true);
  await delay(IGNORE_MOUSE_SETTLE_MS);
  try {
    return await fn();
  } finally {
    for (const win of windows) {
      if (!win.isDestroyed() && !ignoreMousePinned.has(win.id)) {
        win.setIgnoreMouseEvents(false);
      }
    }
  }
}

export function pinHostWindowIgnoreMouse(win: BrowserWindow): void {
  ignoreMousePinned.add(win.id);
  win.on("closed", () => ignoreMousePinned.delete(win.id));
}

async function easeMoveMouse(
  native: ClaudeNativeModule,
  x: number,
  y: number,
  durationSec: number,
): Promise<void> {
  const current = await asPromise(native.mouseLocation());
  const dx = x - current.x;
  const dy = y - current.y;
  if (Math.sqrt(dx * dx + dy * dy) < 1) return;
  const fps = 60;
  const frameMs = 1000 / fps;
  const frames = Math.floor(durationSec * fps);
  if (frames <= 0) {
    await asPromise(native.moveMouse(x, y, false));
    return;
  }
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const ease = 1 - Math.pow(1 - t, 3);
    await asPromise(
      native.moveMouse(
        Math.round(current.x + dx * ease),
        Math.round(current.y + dy * ease),
        false,
      ),
    );
    if (i < frames) await delay(frameMs);
  }
}

async function moveMouseInstant(
  native: ClaudeNativeModule,
  x: number,
  y: number,
): Promise<void> {
  await asPromise(native.moveMouse(x, y, false));
  await delay(MOVE_SETTLE_MS);
}

/** Residual Zki / sv */
export async function moveMouseAnimated(
  x: number,
  y: number,
  animate: boolean,
): Promise<void> {
  const native = requireClaudeNative();
  if (!animate) {
    await moveMouseInstant(native, x, y);
    return;
  }
  const current = await asPromise(native.mouseLocation());
  const dist = Math.hypot(x - current.x, y - current.y);
  const duration = Math.min(dist / 2000, 0.5);
  if (duration < 0.03) {
    await moveMouseInstant(native, x, y);
    return;
  }
  await easeMoveMouse(native, x, y, duration);
  await delay(MOVE_SETTLE_MS);
}

async function withHeldModifiers<T>(
  native: ClaudeNativeModule,
  modifiers: string[],
  fn: () => Promise<T>,
): Promise<T> {
  for (const key of modifiers) await asPromise(native.key(key, "press"));
  try {
    return await fn();
  } finally {
    for (const key of [...modifiers].reverse()) {
      try {
        await asPromise(native.key(key, "release"));
      } catch {
        /* residual swallows release errors */
      }
    }
  }
}

/** Residual ATi — clipboard paste via ctrl+v on win32. */
export async function typeViaClipboard(text: string): Promise<void> {
  const native = requireClaudeNative();
  let previous: string | undefined;
  try {
    previous = clipboard.readText();
  } catch {
    /* proceed without restore */
  }
  try {
    clipboard.writeText(text);
    if (clipboard.readText() !== text) {
      throw new Error("Clipboard write did not round-trip.");
    }
    await asPromise(native.keys([...PASTE_KEYS]));
    await delay(100);
  } finally {
    if (typeof previous === "string") {
      try {
        clipboard.writeText(previous);
      } catch {
        /* residual */
      }
    }
  }
}

export type Win32InputSurface = {
  key: (keySequence: string, repeat?: number) => Promise<void>;
  holdKey: (keyNames: string[], durationMs: number) => Promise<void>;
  type: (text: string, opts: { viaClipboard: boolean }) => Promise<void>;
  typePaced: (text: string, opts?: unknown) => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  moveMouse: (x: number, y: number) => Promise<void>;
  click: (
    x: number,
    y: number,
    button: "left" | "right" | "middle",
    count: 1 | 2 | 3,
    modifiers?: string[],
  ) => Promise<void>;
  mouseDown: () => Promise<void>;
  mouseUp: () => Promise<void>;
  getCursorPosition: () => Promise<{ x: number; y: number }>;
  drag: (
    from: { x: number; y: number } | undefined,
    to: { x: number; y: number },
  ) => Promise<void>;
  scroll: (x: number, y: number, dx: number, dy: number) => Promise<void>;
};

/** Residual eTi */
export function createWin32InputSurface(options: {
  getMouseAnimationEnabled: () => boolean;
}): Win32InputSurface {
  const { getMouseAnimationEnabled } = options;

  return {
    async key(keySequence, repeat = 1) {
      const native = requireClaudeNative();
      const parts = keySequence.split("+").filter((p) => p.length > 0);
      const escape = isEscapeOnly(parts);
      if (repeat <= 1) {
        if (escape) {
          /* residual Zv escape absorb — no-op counter in product */
        }
        await asPromise(native.keys(parts));
        return;
      }
      for (let i = 0; i < repeat; i++) {
        if (i > 0) await delay(8);
        await asPromise(native.keys(parts));
      }
    },

    async holdKey(keyNames, durationMs) {
      const native = requireClaudeNative();
      await withHeldModifiers(native, keyNames, async () => {
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
          await delay(Math.min(50, end - Date.now()));
        }
      });
    },

    async type(text, opts) {
      if (opts.viaClipboard) {
        await typeViaClipboard(text);
        return;
      }
      await asPromise(requireClaudeNative().typeText(text));
    },

    async typePaced(text, opts) {
      await asPromise(requireClaudeNative().typeTextPaced(text, opts));
    },

    async readClipboard() {
      return clipboard.readText();
    },

    async writeClipboard(text) {
      clipboard.writeText(text);
    },

    async moveMouse(x, y) {
      await moveMouseAnimated(x, y, getMouseAnimationEnabled());
    },

    async click(x, y, button, count, modifiers) {
      const native = requireClaudeNative();
      await withHostMouseIgnored(async () => {
        await moveMouseAnimated(x, y, getMouseAnimationEnabled());
        if (modifiers && modifiers.length > 0) {
          await withHeldModifiers(native, modifiers, () =>
            asPromise(native.mouseButton(button, "click", count)),
          );
        } else {
          await asPromise(native.mouseButton(button, "click", count));
        }
      });
    },

    async mouseDown() {
      const native = requireClaudeNative();
      await withHostMouseIgnored(async () => {
        await asPromise(native.mouseButton("left", "press"));
      });
    },

    async mouseUp() {
      const native = requireClaudeNative();
      await withHostMouseIgnored(async () => {
        await asPromise(native.mouseButton("left", "release"));
      });
    },

    async getCursorPosition() {
      return asPromise(requireClaudeNative().mouseLocation());
    },

    async drag(from, to) {
      const native = requireClaudeNative();
      await withHostMouseIgnored(async () => {
        if (from !== undefined) {
          await moveMouseAnimated(from.x, from.y, getMouseAnimationEnabled());
        }
        await asPromise(native.mouseButton("left", "press"));
        await delay(50);
        try {
          await moveMouseAnimated(to.x, to.y, getMouseAnimationEnabled());
        } finally {
          await asPromise(native.mouseButton("left", "release"));
        }
      });
    },

    async scroll(x, y, dx, dy) {
      const native = requireClaudeNative();
      await withHostMouseIgnored(async () => {
        await moveMouseAnimated(x, y, getMouseAnimationEnabled());
        if (dy !== 0) await asPromise(native.mouseScroll(dy, "vertical"));
        if (dx !== 0) await asPromise(native.mouseScroll(dx, "horizontal"));
      });
    },
  };
}

export function isClaudeNativeAvailable(): boolean {
  return maybeGetClaudeNative() !== null;
}
