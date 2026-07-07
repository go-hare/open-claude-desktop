import { app, safeStorage } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

type StoredLocalEnvironment = {
  data: Record<string, string> | string;
  encrypted: boolean;
  version: 1;
};

const storageFileName = "local-session-environment.json";

export function normalizeLocalEnvironment(value: unknown): Record<string, string> {
  const raw = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const env = typeof raw.env === "object" && raw.env !== null ? raw.env as Record<string, unknown> : raw;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export async function getLocalSessionEnvironment(userData = app.getPath("userData")): Promise<Record<string, string>> {
  return readStoredEnvironment(await readStoredFile(userData));
}

export function getLocalSessionEnvironmentSync(userData = app.getPath("userData")): Record<string, string> {
  try {
    return readStoredEnvironment(JSON.parse(fs.readFileSync(storagePath(userData), "utf8")));
  } catch {
    return {};
  }
}

export async function saveLocalSessionEnvironment(value: unknown, userData = app.getPath("userData")): Promise<Record<string, string>> {
  const env = normalizeLocalEnvironment(value);
  await fsp.mkdir(userData, { recursive: true });
  await fsp.writeFile(storagePath(userData), JSON.stringify(serializeEnvironment(env), null, 2), "utf8");
  return env;
}

function storagePath(userData: string): string {
  return path.join(userData, storageFileName);
}

async function readStoredFile(userData: string): Promise<unknown> {
  try {
    return JSON.parse(await fsp.readFile(storagePath(userData), "utf8"));
  } catch {
    return {};
  }
}

function serializeEnvironment(env: Record<string, string>): StoredLocalEnvironment {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        data: safeStorage.encryptString(JSON.stringify(env)).toString("base64"),
        encrypted: true,
        version: 1,
      };
    }
  } catch {
    // Fall back to plain storage when the OS keychain is unavailable.
  }
  return { data: env, encrypted: false, version: 1 };
}

function readStoredEnvironment(value: unknown): Record<string, string> {
  const raw = typeof value === "object" && value !== null ? value as Partial<StoredLocalEnvironment> : {};
  if (raw.encrypted && typeof raw.data === "string") {
    try {
      return normalizeLocalEnvironment(JSON.parse(safeStorage.decryptString(Buffer.from(raw.data, "base64"))));
    } catch {
      return {};
    }
  }
  return normalizeLocalEnvironment(raw.data ?? value);
}
