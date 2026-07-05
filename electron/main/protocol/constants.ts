export const APP_PROTOCOL = "app";
export const APP_HOST = "localhost";
export const APP_ORIGIN = `${APP_PROTOCOL}://${APP_HOST}`;

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export const API_PREFIXES = ["/api/", "/edge-api/", "/v1/", "/v2/", "/mcp-registry/", "/sandbox/"] as const;
export const STATIC_CODE_EXTENSIONS = /\.(m?[jt]sx?|css|map)$/;

export const THIRD_PARTY_NOT_AVAILABLE_BODY = JSON.stringify({
  error: {
    type: "custom_3p_not_available",
    message: "This functionality is not available in third-party mode.",
  },
});
