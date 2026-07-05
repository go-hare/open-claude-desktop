export function custom3pSource() {
  return {
    type: "local",
    remote: false,
  };
}

export function custom3pHealth() {
  return {
    state: "healthy",
    source: custom3pSource(),
    provider: "gateway",
    endpoint: "app://localhost",
    checkedAt: new Date().toISOString(),
  };
}

export function custom3pLoginDesktopStatus() {
  return {
    enabled: true,
    source: custom3pSource(),
    provider: "gateway",
    bootstrapHost: "localhost",
  };
}

export function custom3pBootstrapState() {
  return {
    configured: true,
    url: "app://localhost",
    origin: "local",
    health: "ok",
    lastSyncAt: Date.now(),
    suppliedKeys: ["inferenceProvider", "inferenceGatewayBaseUrl"],
    suppliedValues: {
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: "app://localhost",
    },
  };
}
