/**
 * Official AMA() managedSettings residual (app.asar LocalSessionManager warm/start options).
 *
 *   managedSettings: AMA()
 *   AMA builds policy-tier Settings from enterprise Ti()/ci():
 *     forceLoginOrgUUID, permissions.allow WebFetch(domain:…),
 *     permissions.deny Read(//**)/Edit(//**) + allow folders,
 *     sandbox.network.allowedDomains + allowManagedDomainsOnly,
 *     sandbox.filesystem.allowRead + allowManagedReadPathsOnly
 *
 * Product: map existing coworkEnterpriseConfig readers only — never invent domains/tokens.
 */
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import {
  resolveEnterpriseAllowedWorkspaceFolders,
  resolveEnterpriseForceLoginOrgUUIDs,
  resolveEnterpriseVmEgressPolicy,
  type CoworkEnterpriseConfigDeps,
} from "../coworkHostLoop/coworkEnterpriseConfig";

/**
 * Build official-shaped managedSettings bag from enterprise config residual.
 * Returns undefined when no managed policy applies (omit options.managedSettings).
 */
export function buildCodeManagedSettingsResidual(
  deps: CoworkEnterpriseConfigDeps = {},
): Settings | undefined {
  const forceOrgs = resolveEnterpriseForceLoginOrgUUIDs(deps);
  const egress = resolveEnterpriseVmEgressPolicy(deps);
  const folders = resolveEnterpriseAllowedWorkspaceFolders(deps);

  const forceLoginOrgUUID =
    forceOrgs && forceOrgs.length === 1
      ? forceOrgs[0]
      : forceOrgs && forceOrgs.length > 1
        ? forceOrgs
        : undefined;

  const allow: string[] = [];
  const deny: string[] = [];

  if (egress?.kind === "allowlist" && egress.domains.length > 0) {
    for (const domain of egress.domains) {
      allow.push(`WebFetch(domain:${domain})`);
    }
  }

  const additionalDirectories: string[] = [];
  if (folders !== undefined && folders !== null) {
    // Official Th present (incl empty): deny all absolute paths outside allowlist.
    deny.push("Read(//**)", "Edit(//**)");
    for (const folder of folders) {
      if (!folder) continue;
      allow.push(`Read(${folder}/**)`, `Edit(${folder}/**)`);
      additionalDirectories.push(folder);
    }
  }

  const permissions: Settings["permissions"] | undefined =
    allow.length > 0 || deny.length > 0 || additionalDirectories.length > 0
      ? {
          ...(allow.length > 0 ? { allow } : {}),
          ...(deny.length > 0 ? { deny } : {}),
          ...(additionalDirectories.length > 0
            ? { additionalDirectories }
            : {}),
        }
      : undefined;

  let sandbox: Settings["sandbox"] | undefined;
  if (egress?.kind === "allowlist" && egress.domains.length > 0) {
    sandbox = {
      enabled: true,
      allowUnsandboxedCommands: false,
      network: {
        allowedDomains: [...egress.domains],
        allowManagedDomainsOnly: true,
      },
    };
  }
  if (folders !== undefined && folders !== null && folders.length > 0) {
    sandbox = {
      ...(sandbox ?? { enabled: true, allowUnsandboxedCommands: false }),
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowRead: [...folders],
        allowManagedReadPathsOnly: true,
      },
    };
  }

  const out: Settings = {};
  if (forceLoginOrgUUID !== undefined) {
    // Settings.forceLoginOrgUUID residual (string | string[] in schema).
    (out as Settings & { forceLoginOrgUUID?: string | string[] }).forceLoginOrgUUID =
      forceLoginOrgUUID as string | string[];
  }
  if (permissions) out.permissions = permissions;
  if (sandbox) out.sandbox = sandbox;

  if (Object.keys(out).length === 0) return undefined;
  return out;
}
