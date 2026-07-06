import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const hybridBridgeSpec: NamespaceBridgeSpec = {
  DesktopIntl: {
    invoke: ["requestLocaleChange"],
    sync: ["getInitialLocale"],
    events: ["localeChanged"],
  },
};
