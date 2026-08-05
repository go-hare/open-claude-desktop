/**
 * Residual custom3p MCP OAuth safeStorage bag (app.asar index.js ZD / SUA store helpers).
 * Key: "custom3pMcpOAuth" on electron-store (Yi residual).
 *
 * Stores encrypted base64 blobs for { client, tokens } per server name.
 * data-official-source: app.asar index.js ZD / xv / wni / SUA readEncrypted/writeEncrypted
 */
import { safeStorage } from "electron";
import Store from "electron-store";

export const CUSTOM3P_MCP_OAUTH_STORE_KEY = "custom3pMcpOAuth" as const;

type ServerOAuthFields = {
  client?: string;
  tokens?: string;
};

type OAuthRoot = Record<string, ServerOAuthFields>;

type StoreShape = {
  [CUSTOM3P_MCP_OAUTH_STORE_KEY]?: OAuthRoot;
};

// Residual Yi — shared config store. Product isolates only the OAuth bag key.
const store = new Store<StoreShape>({
  // Match residual configFileMode 0o644 when possible; electron-store defaults are fine.
  clearInvalidConfig: true,
});

function readRoot(): OAuthRoot {
  const bag = store.get(CUSTOM3P_MCP_OAUTH_STORE_KEY);
  return bag && typeof bag === "object" && !Array.isArray(bag) ? { ...bag } : {};
}

function writeRoot(root: OAuthRoot): void {
  store.set(CUSTOM3P_MCP_OAUTH_STORE_KEY, root);
}

export function clearOAuthTokens(serverName: string): void {
  const root = readRoot();
  const entry = root[serverName];
  if (!entry) return;
  delete entry.tokens;
  if (!entry.client && !entry.tokens) {
    delete root[serverName];
  } else {
    root[serverName] = entry;
  }
  writeRoot(root);
  console.info("[custom3p-mcp] cleared OAuth tokens", { server: serverName });
}

export function readAccessToken(serverName: string): string | undefined {
  const root = readRoot();
  const encrypted = root[serverName]?.tokens;
  if (!encrypted) return undefined;
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    const json = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    const parsed = JSON.parse(json) as { access_token?: string };
    return typeof parsed.access_token === "string" ? parsed.access_token : undefined;
  } catch {
    return undefined;
  }
}

export function readEncryptedField<T = unknown>(
  serverName: string,
  field: "client" | "tokens",
): T | undefined {
  const root = readRoot();
  const encrypted = root[serverName]?.[field];
  if (!encrypted) return undefined;
  try {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    const json = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn("[custom3p-mcp] decrypt failed — clearing stored OAuth", {
      server: serverName,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
    clearField(serverName, field);
    return undefined;
  }
}

export function writeEncryptedField(
  serverName: string,
  field: "client" | "tokens",
  value: unknown,
): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[custom3p-mcp] safeStorage unavailable; not persisted", {
      server: serverName,
      field,
    });
    return;
  }
  try {
    const root = readRoot();
    const entry = root[serverName] ?? {};
    entry[field] = safeStorage
      .encryptString(JSON.stringify(value))
      .toString("base64");
    root[serverName] = entry;
    writeRoot(root);
  } catch (error) {
    console.warn("[custom3p-mcp] encrypt failed; not persisted", {
      server: serverName,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearField(
  serverName: string,
  field: "client" | "tokens",
): void {
  const root = readRoot();
  const entry = root[serverName];
  if (!entry) return;
  delete entry[field];
  if (!entry.client && !entry.tokens) {
    delete root[serverName];
  } else {
    root[serverName] = entry;
  }
  writeRoot(root);
}

/** Test helper — wipe bag. */
export function resetCustom3pMcpOAuthStoreForTests(): void {
  store.delete(CUSTOM3P_MCP_OAUTH_STORE_KEY);
}
