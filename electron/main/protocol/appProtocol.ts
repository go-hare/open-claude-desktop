import { app, protocol } from "electron";
import { loadOrCreateCustom3pInstallId } from "../services/custom3p/custom3pInstallIdentity";
import { APP_HOST, APP_ORIGIN, APP_PROTOCOL } from "./constants";
import { createCustom3pApiHandler, type Custom3pApiOptions } from "./custom3pApi";
import { createStaticIonDistHandler } from "./staticIonDist";
import { installShellCustomProtocolHandlers, registerShellCustomProtocolSchemes } from "./customShellProtocols";

export type AppProtocolOptions = {
  /**
   * Primary app:// SPA root (product-web when present).
   * Historical name: ionDistRoot.
   */
  ionDistRoot: string;
  /**
   * Official residual ion-dist for setup-desktop-3p / device-code-verify.
   * When omitted, residual routes fall back to ionDistRoot (breaks when primary is product-web).
   */
  residualIonDistRoot?: string;
  custom3p?: Omit<Custom3pApiOptions, "ionDistRoot">;
};

export function registerAppProtocolScheme(): void {
  registerShellCustomProtocolSchemes({
    scheme: APP_PROTOCOL,
    privileges: {
      bypassCSP: true,
      corsEnabled: true,
      supportFetchAPI: true,
      secure: true,
      standard: true,
    },
  });
}

/** Original `prr(ionDistPath, discoveredRendererConfig)` equivalent. */
export function installAppProtocolHandler(options: AppProtocolOptions): void {
  installShellCustomProtocolHandlers();

  // Dual-root: product-web primary + official ion-dist residual for Custom3p setup SPA.
  const staticHandler = createStaticIonDistHandler({
    root: options.ionDistRoot,
    residualRoot: options.residualIonDistRoot,
  });
  const installId = options.custom3p?.installId ?? loadOrCreateCustom3pInstallId({ userDataPath: app.getPath("userData") });
  // i18n under residual ion-dist; prefer residual when product-web is primary.
  const apiIonRoot = options.residualIonDistRoot ?? options.ionDistRoot;
  const apiHandler = createCustom3pApiHandler({ ionDistRoot: apiIonRoot, ...(options.custom3p ?? {}), installId });

  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response(null, { status: 404 });

    const origin = request.headers.get("Origin");
    // Opaque sandboxed iframe (no allow-same-origin) loads /sandbox-runtime/*
    // with Origin: null. Allow that only for the product-local sandbox path.
    const isSandboxRuntime =
      url.pathname === "/sandbox-runtime" ||
      url.pathname.startsWith("/sandbox-runtime/");
    if (
      origin &&
      origin !== APP_ORIGIN &&
      !(isSandboxRuntime && (origin === "null" || origin === "Null"))
    ) {
      return new Response(null, { status: 403 });
    }

    return (await apiHandler(request)) ?? staticHandler(request);
  });
}
