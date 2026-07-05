import type { NamespaceBridgeSpec } from "../../../shared/bridge/spec";

export const internalFindInPageBridgeSpec: NamespaceBridgeSpec = {
  FindInPage: {
    invoke: ["findInPage", "stopFindInPage", "endFindSession"],
  },
};

export const findInPageProviderBridgeSpec: NamespaceBridgeSpec = {
  FindInPageProvider: {
    invoke: ["findRequest", "findClear", "reportFindResult", "setProviderActive"],
  },
};
