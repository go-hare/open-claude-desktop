import { app, protocol } from "electron";
import { loadOrCreateCustom3pInstallId } from "../services/custom3p/custom3pInstallIdentity";
import { APP_HOST, APP_ORIGIN, APP_PROTOCOL } from "./constants";
import { createCustom3pApiHandler, type Custom3pApiOptions } from "./custom3pApi";
import { createStaticIonDistHandler } from "./staticIonDist";
import { installShellCustomProtocolHandlers, registerShellCustomProtocolSchemes } from "./customShellProtocols";

export type AppProtocolOptions = {
  ionDistRoot: string;
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

  const staticHandler = createStaticIonDistHandler({ root: options.ionDistRoot });
  const installId = options.custom3p?.installId ?? loadOrCreateCustom3pInstallId({ userDataPath: app.getPath("userData") });
  const apiHandler = createCustom3pApiHandler({ ionDistRoot: options.ionDistRoot, ...(options.custom3p ?? {}), installId });

  protocol.handle(APP_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response(null, { status: 404 });

    const origin = request.headers.get("Origin");
    if (origin && origin !== APP_ORIGIN) return new Response(null, { status: 403 });

    return (await apiHandler(request)) ?? staticHandler(request);
  });
}
