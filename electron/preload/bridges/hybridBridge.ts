import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const hybridBridgeSpec: NamespaceBridgeSpec = {
  DesktopIntl: {
    invoke: ["getInitialLocale", "requestLocaleChange"],
    events: ["localeChanged"],
  },
};
