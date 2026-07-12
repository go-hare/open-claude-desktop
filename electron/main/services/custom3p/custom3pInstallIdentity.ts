import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const INSTALL_ID_FILE = "custom3p-install-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LoadInstallIdOptions = {
  createUuid?: () => string;
  userDataPath: string;
};

export function loadOrCreateCustom3pInstallId(options: LoadInstallIdOptions): string {
  const filePath = path.join(options.userDataPath, INSTALL_ID_FILE);
  const persisted = readInstallId(filePath);
  if (persisted) return persisted;
  const installId =
    latestLegacyAccountId(options.userDataPath) ?? (options.createUuid ?? crypto.randomUUID)();
  writeInstallId(filePath, installId);
  return installId;
}

function readInstallId(filePath: string): string | null {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function latestLegacyAccountId(userDataPath: string): string | null {
  const root = path.join(userDataPath, "local-agent-mode-sessions");
  try {
    return (
      fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
        .map((entry) => legacyAccount(root, entry.name))
        .filter((entry): entry is { id: string; modifiedAt: number } => entry !== null)
        .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.id ?? null
    );
  } catch {
    return null;
  }
}

function legacyAccount(root: string, id: string): { id: string; modifiedAt: number } | null {
  const accountPath = path.join(root, id);
  try {
    const hasSession = fs
      .readdirSync(accountPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .some((entry) => organizationHasSession(path.join(accountPath, entry.name)));
    return hasSession ? { id, modifiedAt: fs.statSync(accountPath).mtimeMs } : null;
  } catch {
    return null;
  }
}

function organizationHasSession(directory: string): boolean {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith(".json"));
  } catch {
    return false;
  }
}

function writeInstallId(filePath: string, installId: string): void {
  if (!UUID_PATTERN.test(installId)) throw new Error("Custom 3P install id must be a UUID");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${installId}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}
