/**
 * Official OrbitDeploys residual (app.asar PCr / JCr / KCr / qCr / VCr / jCr / Tz).
 *
 * File: userData/orbit-deploys.json
 * Shape: { deploys: Record<key, { url: string, pinned: boolean }> }
 *
 * IPC:
 *   getAll() → JSON.stringify(deploys map)  // string, not array
 *   setDeploy(key, url) → void (preserve pinned)
 *   removeDeploy(key) → void
 *   setPinned(key, pinned) → void
 *
 * data-official-source: app.asar PCr="orbit-deploys.json" / KCr / qCr / VCr / jCr
 *   gxt.setImplementation getAll → JSON.stringify(await KCr())
 */

import fs from "node:fs/promises";
import path from "node:path";

export type OrbitDeployEntry = {
  url: string;
  pinned: boolean;
};

export type OrbitDeploysFile = {
  deploys: Record<string, OrbitDeployEntry>;
};

export function orbitDeploysFilePath(userData: string): string {
  return path.join(userData, "orbit-deploys.json");
}

function emptyFile(): OrbitDeploysFile {
  return { deploys: {} };
}

export function parseOrbitDeploysFile(raw: unknown): OrbitDeploysFile {
  if (!raw || typeof raw !== "object") return emptyFile();
  const o = raw as Record<string, unknown>;
  // Official: missing/invalid "deploys" object → fresh empty (caller may warn).
  if (!("deploys" in o) || !o.deploys || typeof o.deploys !== "object") {
    return emptyFile();
  }
  const deploys: Record<string, OrbitDeployEntry> = {};
  for (const [key, value] of Object.entries(
    o.deploys as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object") continue;
    const e = value as Record<string, unknown>;
    if (typeof e.url !== "string") continue;
    deploys[key] = {
      url: e.url,
      pinned: e.pinned === true,
    };
  }
  return { deploys };
}

export class OrbitDeploysResidual {
  private cache: OrbitDeploysFile | null = null;
  private loadPromise: Promise<OrbitDeploysFile> | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<OrbitDeploysFile> {
    if (this.cache) return this.cache;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = JSON.parse(await fs.readFile(this.filePath, "utf8"));
          // Official: invalid shape → warn + fresh
          if (
            !raw ||
            typeof raw !== "object" ||
            !("deploys" in (raw as object)) ||
            typeof (raw as { deploys?: unknown }).deploys !== "object" ||
            (raw as { deploys?: unknown }).deploys === null
          ) {
            console.warn("[orbitDeploys] file shape invalid, starting fresh");
            this.cache = emptyFile();
            return this.cache;
          }
          this.cache = parseOrbitDeploysFile(raw);
          return this.cache;
        } catch (err) {
          const code =
            err && typeof err === "object" && "code" in err
              ? (err as { code?: string }).code
              : undefined;
          if (code !== "ENOENT") {
            console.warn("[orbitDeploys] read failed, starting fresh: %o", {
              err,
            });
          }
          this.cache = emptyFile();
          return this.cache;
        }
      })();
    }
    return this.loadPromise;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.cache),
        "utf8",
      );
    } catch (err) {
      console.error("[orbitDeploys] write failed: %o", { err });
    }
  }

  /** Official KCr: return deploys map (not stringified). */
  async getAll(): Promise<Record<string, OrbitDeployEntry>> {
    const file = await this.load();
    return { ...file.deploys };
  }

  /**
   * Official IPC getAll residual: JSON.stringify(deploys map).
   * Validator requires typeof result === "string".
   */
  async getAllJson(): Promise<string> {
    return JSON.stringify(await this.getAll());
  }

  /** Official qCr(key, url): preserve existing pinned. */
  async setDeploy(key: string, url: string): Promise<void> {
    const file = await this.load();
    const prev = file.deploys[key];
    file.deploys[key] = {
      url,
      pinned: prev?.pinned ?? false,
    };
    await this.persist();
  }

  /** Official VCr(key). */
  async removeDeploy(key: string): Promise<void> {
    const file = await this.load();
    if (key in file.deploys) {
      delete file.deploys[key];
      await this.persist();
    }
  }

  /** Official jCr(key, pinned). */
  async setPinned(key: string, pinned: boolean): Promise<void> {
    const file = await this.load();
    const prev = file.deploys[key];
    if (prev && prev.pinned !== pinned) {
      file.deploys[key] = { ...prev, pinned };
      await this.persist();
    }
  }
}

let singleton: OrbitDeploysResidual | null = null;

export function getOrbitDeploysResidual(
  userData?: string,
): OrbitDeploysResidual {
  if (!singleton) {
    const base =
      userData ??
      // lazy: only when first used from main
      (() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require("electron") as typeof import("electron");
        return app.getPath("userData");
      })();
    singleton = new OrbitDeploysResidual(orbitDeploysFilePath(base));
  }
  return singleton;
}

/** Test helper — reset singleton. */
export function resetOrbitDeploysResidualForTests(): void {
  singleton = null;
}
