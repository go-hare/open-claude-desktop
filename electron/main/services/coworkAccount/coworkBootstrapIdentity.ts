import { net } from "electron";
import type { CoworkAccountIdentity } from "./coworkAccountContext";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function coworkIdentityFromBootstrap(
  value: unknown,
): CoworkAccountIdentity | null {
  const account = record(record(value).account);
  const accountUuid = string(account.uuid);
  const memberships = Array.isArray(account.memberships) ? account.memberships : [];
  for (const membership of memberships) {
    const organization = record(record(membership).organization);
    const organizationUuid = string(organization.uuid);
    if (accountUuid && organizationUuid) {
      return { accountUuid, organizationUuid };
    }
  }
  return null;
}

export async function loadCoworkBootstrapIdentity(): Promise<CoworkAccountIdentity | null> {
  const response = await net.fetch("app://localhost/api/bootstrap");
  if (!response.ok) return null;
  return coworkIdentityFromBootstrap(await response.json());
}
