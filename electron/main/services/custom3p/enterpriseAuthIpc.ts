/**
 * Desktop IPC surface for enterprise interactive auth residuals.
 * Invoked from Setup / login repair — never invents tokens without browser flow.
 *
 * Handlers follow product IPC convention: first arg is IpcMainInvokeEvent.
 */
import type { IpcMainInvokeEvent } from "electron";
import {
  needsBedrockSsoInteractiveAuth,
  revokeBedrockSsoAuth,
  runBedrockSsoAuth,
  getBedrockSsoDeviceUi,
  resolveBedrockRoleCredentials,
} from "./enterpriseBedrockSsoAuth";
import {
  clearBootstrapOidcToken,
  fetchEnterpriseBootstrapConfig,
  NeedsBootstrapAuthError,
} from "./enterpriseBootstrapOidc";
import {
  needsVertexInteractiveAuth,
  revokeVertexAuth,
  runVertexInteractiveAuth,
  readVertexAuthorizedUser,
} from "./enterpriseVertexAuth";
import {
  getEnterpriseCredentialHelperLastRun,
  hasEnterpriseCredentialHelper,
  runEnterpriseCredentialHelperWithTtl,
} from "./enterpriseCredentialHelper";
import {
  isEnterpriseNonessentialServicesDisabled,
  resolveEnterpriseIdentityPolicy,
} from "../coworkHostLoop/coworkEnterpriseConfig";

export function createEnterpriseAuthIpcHandlers() {
  return {
    EnterpriseAuth: {
      identityPolicy: async (_event: IpcMainInvokeEvent) =>
        resolveEnterpriseIdentityPolicy(),
      nonessentialServicesDisabled: async (_event: IpcMainInvokeEvent) =>
        isEnterpriseNonessentialServicesDisabled(),

      needsVertexAuth: async (_event: IpcMainInvokeEvent) =>
        needsVertexInteractiveAuth(),
      hasVertexAdc: async (_event: IpcMainInvokeEvent) =>
        readVertexAuthorizedUser() !== null,
      runVertexAuth: async (_event: IpcMainInvokeEvent) => {
        await runVertexInteractiveAuth();
        return { ok: true as const };
      },
      revokeVertexAuth: async (_event: IpcMainInvokeEvent) => {
        await revokeVertexAuth();
        return { ok: true as const };
      },

      needsBedrockSsoAuth: async (_event: IpcMainInvokeEvent) =>
        needsBedrockSsoInteractiveAuth(),
      runBedrockSsoAuth: async (_event: IpcMainInvokeEvent) => {
        await runBedrockSsoAuth();
        return { ok: true as const, device: getBedrockSsoDeviceUi() };
      },
      revokeBedrockSsoAuth: async (_event: IpcMainInvokeEvent) => {
        await revokeBedrockSsoAuth();
        return { ok: true as const };
      },
      probeBedrockRoleCredentials: async (_event: IpcMainInvokeEvent) => {
        const creds = await resolveBedrockRoleCredentials();
        return {
          ok: creds !== null,
          hasAccessKey: Boolean(creds?.accessKeyId),
        };
      },

      fetchBootstrap: async (
        _event: IpcMainInvokeEvent,
        interactive?: unknown,
      ) => {
        try {
          return await fetchEnterpriseBootstrapConfig(
            {},
            { interactive: interactive !== false },
          );
        } catch (error) {
          if (error instanceof NeedsBootstrapAuthError) {
            return { ok: false as const, kind: "auth" as const };
          }
          throw error;
        }
      },
      clearBootstrapOidc: async (_event: IpcMainInvokeEvent) => {
        clearBootstrapOidcToken();
        return { ok: true as const };
      },

      hasCredentialHelper: async (_event: IpcMainInvokeEvent) =>
        hasEnterpriseCredentialHelper(),
      runCredentialHelper: async (_event: IpcMainInvokeEvent) => {
        const token = await runEnterpriseCredentialHelperWithTtl();
        return {
          ok: token !== null,
          hasToken: token !== null,
          lastRun: getEnterpriseCredentialHelperLastRun(),
        };
      },
    },
  };
}
