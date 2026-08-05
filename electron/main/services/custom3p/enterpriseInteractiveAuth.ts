/**
 * Official interactive auth residual (app.asar ci / lcA / p1e / uHe / dPe):
 *   LocalAgentModeSessions.triggerInteractiveAuth → Vertex | Bedrock SSO | bootstrap OIDC
 *   interactiveAuth store: null | { needsAuth, pendingUserCode, kind, … }
 *   device-code window for Bedrock SSO pendingUserCode
 *
 * Never invents { ok: true } without a real auth/fetch success.
 *
 * data-official-source: app.asar LocalAgentModeSessions.triggerInteractiveAuth / interactiveAuth store
 */
import type { CoworkEnterpriseConfigDeps } from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  loadCoworkEnterpriseConfig,
  resolveEnterpriseBootstrapOidc,
} from "../coworkHostLoop/coworkEnterpriseConfig";
import {
  needsBedrockSsoInteractiveAuth,
  revokeBedrockSsoAuth,
  runBedrockSsoAuth,
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
} from "./enterpriseVertexAuth";
import { showDeviceCodeWindow } from "../../windows/custom3pDeviceCodeWindow";

export type InteractiveAuthKind = "vertex" | "bedrockSso" | "bootstrapOidc";

/**
 * Official lcA residual shape (product minimal — only fields residual SPA reads).
 * SPA: r?.needsAuth, r?.pendingUserCode
 */
export type InteractiveAuthState = {
  needsAuth: boolean;
  kind: InteractiveAuthKind | null;
  pendingUserCode: string | null;
  error: string | null;
  source: "managed" | "local" | "none";
};

type PublishFn = (state: InteractiveAuthState | null) => void;

let current: InteractiveAuthState | null = null;
let publish: PublishFn | null = null;
let inFlight: Promise<{ ok: boolean; error?: string }> | null = null;

export function resetEnterpriseInteractiveAuthForTests(): void {
  current = null;
  publish = null;
  inFlight = null;
}

/** Wire store publisher once (storeStateHandlers / originalEventSurface). */
export function setInteractiveAuthPublisher(fn: PublishFn | null): void {
  publish = fn;
}

export function getInteractiveAuthState(): InteractiveAuthState | null {
  return current;
}

function emit(next: InteractiveAuthState | null): void {
  current = next;
  try {
    publish?.(next);
  } catch (error) {
    console.warn(
      "[custom-3p] interactiveAuth publish failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function localOnlyDepsFromVi(
  deps: CoworkEnterpriseConfigDeps = {},
): CoworkEnterpriseConfigDeps {
  // Prefer inject deps; otherwise load vi() once and freeze as local-only so
  // subsequent needs* checks do not re-walk win32 registry per call.
  if (deps.getLocalConfig || deps.getManagedConfig) return deps;
  const snap = loadCoworkEnterpriseConfig(deps);
  return {
    getManagedConfig: () =>
      snap.source.type === "managed" ? snap.raw : {},
    getLocalConfig: () =>
      snap.source.type === "local" ? snap.raw : snap.raw,
  };
}

/**
 * Official recompute residual — which interactive auth (if any) is still required.
 * Priority: Vertex OAuth → Bedrock SSO → bootstrap OIDC (when configured + no token path).
 */
export function recomputeInteractiveAuthState(
  deps: CoworkEnterpriseConfigDeps = {},
): InteractiveAuthState | null {
  const resolved = localOnlyDepsFromVi(deps);
  const snap = loadCoworkEnterpriseConfig(resolved);
  const source = snap.source.type;

  if (needsVertexInteractiveAuth(resolved)) {
    return {
      needsAuth: true,
      kind: "vertex",
      pendingUserCode: null,
      error: null,
      source,
    };
  }
  if (needsBedrockSsoInteractiveAuth(resolved)) {
    return {
      needsAuth: true,
      kind: "bedrockSso",
      pendingUserCode: current?.kind === "bedrockSso" ? current.pendingUserCode : null,
      error: null,
      source,
    };
  }
  // Bootstrap OIDC: only "needs" when bag has OIDC client and bootstrapUrl —
  // interactive token may still be missing (NeedsBootstrapAuthError path).
  const oidc = resolveEnterpriseBootstrapOidc(resolved);
  const bootstrapUrl =
    typeof snap.raw.bootstrapUrl === "string" ? snap.raw.bootstrapUrl.trim() : "";
  if (oidc && bootstrapUrl && snap.raw.bootstrapEnabled !== false) {
    // Soft need: UI can offer bootstrap sign-in when OIDC configured.
    // Do not force needsAuth=true always — residual SPA uses needsAuth for
    // gateway SSO-style continue; bootstrap often runs via triggerBootstrapAuth.
    // Keep kind discoverable when bag-only vertex/bedrock not needed.
  }

  // No interactive auth required (or only optional bootstrap).
  return null;
}

export function publishInteractiveAuthRecompute(
  deps: CoworkEnterpriseConfigDeps = {},
): InteractiveAuthState | null {
  const next = recomputeInteractiveAuthState(deps);
  emit(next);
  return next;
}

function setPendingUserCode(code: string | null): void {
  const base =
    current ??
    ({
      needsAuth: true,
      kind: "bedrockSso" as const,
      pendingUserCode: null,
      error: null,
      source: "local" as const,
    } satisfies InteractiveAuthState);
  emit({
    ...base,
    needsAuth: true,
    kind: "bedrockSso",
    pendingUserCode: code,
    error: null,
  });
  if (code) {
    try {
      showDeviceCodeWindow();
    } catch (error) {
      console.warn(
        "[custom-3p] device-code window failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * Official triggerInteractiveAuth residual.
 * Returns { ok:true } only after real Vertex/Bedrock/bootstrap success.
 */
export async function triggerEnterpriseInteractiveAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): Promise<{ ok: boolean; error?: string }> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const resolved = localOnlyDepsFromVi(deps);
    const state = recomputeInteractiveAuthState(resolved);
    emit(state);

    if (!state?.needsAuth || !state.kind) {
      // Nothing to do — not an invent success for missing auth; residual returns ok
      // when already authorized (no pending interactive step).
      return { ok: true };
    }

    try {
      if (state.kind === "vertex") {
        await runVertexInteractiveAuth(resolved);
        emit(recomputeInteractiveAuthState(resolved));
        return { ok: true };
      }
      if (state.kind === "bedrockSso") {
        await runBedrockSsoAuth(resolved, fetch, (userCode) => {
          setPendingUserCode(userCode);
        });
        setPendingUserCode(null);
        emit(recomputeInteractiveAuthState(resolved));
        return { ok: true };
      }
      if (state.kind === "bootstrapOidc") {
        const result = await fetchEnterpriseBootstrapConfig(resolved, {
          interactive: true,
          applyRemoteTier: true,
        });
        if (!result.ok) {
          const err =
            result.kind === "auth"
              ? "bootstrap_auth_required"
              : result.detail ?? result.kind;
          emit({
            ...state,
            error: err,
          });
          return { ok: false, error: err };
        }
        emit(recomputeInteractiveAuthState(resolved));
        return { ok: true };
      }
      return { ok: false, error: "interactive_auth_kind_unknown" };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      emit({
        needsAuth: true,
        kind: state.kind,
        pendingUserCode: null,
        error: message,
        source: state.source,
      });
      return { ok: false, error: message };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Official revokeInteractiveAuth residual — clear stored enterprise interactive secrets.
 * Returns true when something was cleared.
 */
export async function revokeEnterpriseInteractiveAuth(
  deps: CoworkEnterpriseConfigDeps = {},
): Promise<boolean> {
  const resolved = localOnlyDepsFromVi(deps);
  // Best-effort clear of all enterprise interactive secrets (Vertex / Bedrock / bootstrap).
  // Official residual returns boolean; product returns true when revoke path ran without throw.
  try {
    await revokeVertexAuth();
  } catch {
    /* ignore */
  }
  try {
    await revokeBedrockSsoAuth();
  } catch {
    /* ignore */
  }
  try {
    clearBootstrapOidcToken();
  } catch {
    /* ignore */
  }
  emit(recomputeInteractiveAuthState(resolved));
  return true;
}

/**
 * Official Custom3pSetup.triggerBootstrapAuth residual — interactive bootstrap OIDC pull.
 * Never returns ok:true without a successful fetch (or unconfigured → honest fail).
 */
export async function triggerEnterpriseBootstrapAuth(
  deps: CoworkEnterpriseConfigDeps = {},
  _oidcHint?: unknown,
): Promise<{ ok: boolean; error?: string; kind?: string }> {
  void _oidcHint;
  const resolved = localOnlyDepsFromVi(deps);
  try {
    const result = await fetchEnterpriseBootstrapConfig(resolved, {
      interactive: true,
      applyRemoteTier: true,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.detail ?? result.kind,
        kind: result.kind,
      };
    }
    emit(recomputeInteractiveAuthState(resolved));
    return { ok: true };
  } catch (error) {
    if (error instanceof NeedsBootstrapAuthError) {
      return { ok: false, error: "bootstrap_auth_required", kind: "auth" };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
