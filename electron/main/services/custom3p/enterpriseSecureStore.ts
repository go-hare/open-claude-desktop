/**
 * Official Oi / safeStorage residual for custom3p secrets:
 *   k7 = "custom3pVertexOAuth"
 *   Q7 = "custom3pBedrockSso"
 *   bootstrap OIDC token cache
 *
 * Encrypt with electron.safeStorage when available; otherwise refuse persist
 * (matches official "safeStorage is unavailable" throw on write) unless
 * CLAUDE_ENTERPRISE_AUTH_PLAINTEXT=1 (tests / headless).
 */
import { safeStorage } from "electron";
import Store from "electron-store";

export const ENTERPRISE_SECRET_KEYS = {
  vertexOAuth: "custom3pVertexOAuth",
  bedrockSso: "custom3pBedrockSso",
  bootstrapOidc: "custom3pBootstrapOidc",
} as const;

/** In-process fallback when electron-store / safeStorage unavailable (vitest). */
let memorySecrets: Record<string, string> = {};
let diskStore: Store<{ secrets: Record<string, string> }> | null = null;
let diskStoreFailed = false;

function encryptionAvailable(): boolean {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function getDiskStore(): Store<{ secrets: Record<string, string> }> | null {
  if (diskStoreFailed) return null;
  if (diskStore) return diskStore;
  try {
    diskStore = new Store<{ secrets: Record<string, string> }>({
      name: "enterprise-auth-secrets",
      defaults: { secrets: {} },
    });
    return diskStore;
  } catch {
    diskStoreFailed = true;
    return null;
  }
}

function readSecretsBag(): Record<string, string> {
  const store = getDiskStore();
  if (!store) return { ...memorySecrets };
  try {
    return { ...memorySecrets, ...(store.get("secrets") ?? {}) };
  } catch {
    return { ...memorySecrets };
  }
}

function writeSecretsBag(secrets: Record<string, string>): void {
  memorySecrets = { ...secrets };
  const store = getDiskStore();
  if (!store) return;
  try {
    store.set("secrets", secrets);
  } catch {
    /* memory already updated */
  }
}

export function readEnterpriseSecretJson<T>(key: string): T | null {
  const raw = readSecretsBag()[key];
  if (!raw || typeof raw !== "string") return null;
  try {
    if (!encryptionAvailable()) {
      // Read plaintext fallback only if previously written without encryption (tests).
      return JSON.parse(raw) as T;
    }
    const decrypted = safeStorage.decryptString(Buffer.from(raw, "base64"));
    return JSON.parse(decrypted) as T;
  } catch {
    deleteEnterpriseSecret(key);
    return null;
  }
}

export function writeEnterpriseSecretJson(
  key: string,
  value: unknown,
): void {
  if (!encryptionAvailable()) {
    // Tests / headless: allow plaintext with env gate only.
    if (process.env.CLAUDE_ENTERPRISE_AUTH_PLAINTEXT !== "1") {
      throw new Error(
        "safeStorage is unavailable — cannot persist enterprise credentials",
      );
    }
    const secrets = readSecretsBag();
    secrets[key] = JSON.stringify(value);
    writeSecretsBag(secrets);
    return;
  }
  const encrypted = safeStorage
    .encryptString(JSON.stringify(value))
    .toString("base64");
  const secrets = readSecretsBag();
  secrets[key] = encrypted;
  writeSecretsBag(secrets);
}

export function deleteEnterpriseSecret(key: string): void {
  const secrets = readSecretsBag();
  delete secrets[key];
  writeSecretsBag(secrets);
}

export function resetEnterpriseSecretsForTests(): void {
  memorySecrets = {};
  writeSecretsBag({});
}
