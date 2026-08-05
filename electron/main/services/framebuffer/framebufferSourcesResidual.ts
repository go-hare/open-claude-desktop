/**
 * Framebuffer source residual for FramebufferPreview.listSources(cwd).
 *
 * Official main-window ixt residual returns [] always when RFB unavailable.
 * Official MCP / launch residual documents:
 *   .claude/launch.json configurations[] type:"framebuffer"
 *   + .claude/launch.d/*.json single-entry files
 *   shape: { name, type:"framebuffer", vncUrl, serverFlavor?: "standard"|"vz" }
 *
 * Product residual:
 *   - listSources(cwd) reads real configs (no invent sources)
 *   - requestFramePort / attach still empty/throw without MessagePort RFB session
 *   - Never invent connected frames
 *
 * data-official-source: app.asar iLi / rLi / ixt empty residual / launch framebuffer
 */

import fs from "node:fs/promises";
import path from "node:path";

export type FramebufferSourceResidual = {
  name: string;
  vncUrl: string;
  serverFlavor: "standard" | "vz";
  /** Origin file for diagnostics — not invent. */
  sourcePath: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseFramebufferEntry(
  raw: unknown,
  sourcePath: string,
  fallbackName: string,
): FramebufferSourceResidual | null {
  const o = asRecord(raw);
  if (!o) return null;
  const type = typeof o.type === "string" ? o.type : "";
  if (type && type !== "framebuffer" && type !== "vnc") return null;
  // Require explicit framebuffer type OR vncUrl present with name
  const vncUrl =
    (typeof o.vncUrl === "string" && o.vncUrl) ||
    (typeof o.url === "string" && o.url) ||
    "";
  if (!vncUrl) return null;
  if (!/^vnc:\/\//i.test(vncUrl) && !/^rfb:\/\//i.test(vncUrl)) {
    // Only accept real VNC/RFB schemes — no invent desktopCapturer invent
    return null;
  }
  if (type !== "framebuffer" && type !== "vnc" && !o.vncUrl) return null;
  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim()
      : fallbackName;
  const flavorRaw =
    typeof o.serverFlavor === "string" ? o.serverFlavor.toLowerCase() : "standard";
  const serverFlavor: "standard" | "vz" = flavorRaw === "vz" ? "vz" : "standard";
  return { name, vncUrl, serverFlavor, sourcePath };
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Official-ish list of framebuffer sources under cwd.
 * Empty when no configs — matches empty residual honesty.
 */
export async function listFramebufferSourcesFromCwd(
  cwd: unknown,
): Promise<FramebufferSourceResidual[]> {
  if (typeof cwd !== "string" || !cwd.trim()) return [];
  const root = cwd.trim();
  const out: FramebufferSourceResidual[] = [];
  const seen = new Set<string>();

  const push = (entry: FramebufferSourceResidual | null) => {
    if (!entry) return;
    const key = `${entry.name}\0${entry.vncUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  };

  // .claude/launch.json configurations[]
  const launchJson = path.join(root, ".claude", "launch.json");
  const launchParsed = await readJsonFile(launchJson);
  const launchObj = asRecord(launchParsed);
  const configs = launchObj?.configurations;
  if (Array.isArray(configs)) {
    configs.forEach((entry, index) => {
      push(
        parseFramebufferEntry(
          entry,
          launchJson,
          `framebuffer-${index + 1}`,
        ),
      );
    });
  }

  // .claude/launch.d/* single-entry JSON
  const launchD = path.join(root, ".claude", "launch.d");
  try {
    const names = await fs.readdir(launchD);
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(launchD, name);
      const parsed = await readJsonFile(filePath);
      // single entry or { configurations: [...] }
      const bag = asRecord(parsed);
      if (bag?.configurations && Array.isArray(bag.configurations)) {
        bag.configurations.forEach((entry, index) => {
          push(
            parseFramebufferEntry(
              entry,
              filePath,
              path.basename(name, ".json") + `-${index + 1}`,
            ),
          );
        });
      } else {
        push(
          parseFramebufferEntry(
            parsed,
            filePath,
            path.basename(name, ".json"),
          ),
        );
      }
    }
  } catch {
    /* no launch.d */
  }

  return out;
}

/**
 * Official listSources residual shape for IPC: array of source bags.
 * Product maps residual → FE-ish { name, vncUrl, serverFlavor }.
 */
export async function listFramebufferSourcesIpc(
  cwd: unknown,
): Promise<Array<Record<string, unknown>>> {
  const list = await listFramebufferSourcesFromCwd(cwd);
  return list.map((s) => ({
    name: s.name,
    vncUrl: s.vncUrl,
    serverFlavor: s.serverFlavor,
  }));
}
