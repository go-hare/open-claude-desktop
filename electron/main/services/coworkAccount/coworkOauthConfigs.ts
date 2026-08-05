/**
 * Official OAuth config residual (app.asar h7 / O_ / _M / Uv / II / THe / kHe / d7).
 *
 * COWORK_OAUTH_CONFIGS (h7) is the sessions-bridge IIr path.
 * Product residual: production defaults + env override surface; no invent login.
 *
 * data-official-source: app.asar h7 / N5t / Uv / cbA / LrA / MHe / THe / kHe / II / Gm
 */

/** Official cbA */
export const COWORK_OAUTH_DEFAULT_API_HOST = "https://api.anthropic.com";

/** Official LrA cookie domain residual */
export const COWORK_OAUTH_CLAUDE_AI_DOMAIN = ".claude.ai";

/** Official RM */
export const COWORK_OAUTH_LOCAL_DOMAIN = "localhost";

/** Official MHe — expires_in seconds when scope lacks sessions */
export const COWORK_OAUTH_DEFAULT_EXPIRES_IN = 365 * 24 * 60 * 60;

/** Official Uv base scope (COWORK / CLAUDE_CODE configs) */
export const COWORK_OAUTH_BASE_SCOPE =
  "user:inference user:file_upload user:profile";

/**
 * Official IIr / sessions-bridge getApiToken scope residual.
 * Adds user:sessions:claude_code for Dispatch bridge.
 */
export const COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE =
  "user:inference user:profile user:sessions:claude_code";

/** Official N5t — COWORK production clientId */
export const COWORK_OAUTH_CLIENT_ID_PRODUCTION =
  "a473d7bb-17ac-43a7-abc0-a1343d7c2805";

/** Official NHe local redirect */
export const COWORK_OAUTH_REDIRECT_LOCAL =
  "http://localhost:3000/oauth/code/callback";

/** Official production console callback */
export const COWORK_OAUTH_REDIRECT_PRODUCTION =
  "https://console.anthropic.com/oauth/code/callback";

export type CoworkOauthEnvironment = "production" | "staging" | "local";

export type CoworkOauthConfig = {
  apiHost: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  domain: string;
};

/** Official h7 residual */
export const COWORK_OAUTH_CONFIGS: Record<
  CoworkOauthEnvironment,
  CoworkOauthConfig
> = {
  production: {
    apiHost: COWORK_OAUTH_DEFAULT_API_HOST,
    clientId: COWORK_OAUTH_CLIENT_ID_PRODUCTION,
    redirectUri: COWORK_OAUTH_REDIRECT_PRODUCTION,
    scope: COWORK_OAUTH_BASE_SCOPE,
    domain: COWORK_OAUTH_CLAUDE_AI_DOMAIN,
  },
  staging: {
    apiHost: "https://api-staging.anthropic.com",
    clientId: "4ce313b0-81de-425a-89ff-d0611fdc6554",
    redirectUri: "https://console.staging.ant.dev/oauth/code/callback",
    scope: COWORK_OAUTH_BASE_SCOPE,
    domain: COWORK_OAUTH_LOCAL_DOMAIN,
  },
  local: {
    apiHost: "http://localhost:8000",
    clientId: "4ce313b0-81de-425a-89ff-d0611fdc6554",
    redirectUri: COWORK_OAUTH_REDIRECT_LOCAL,
    scope: COWORK_OAUTH_BASE_SCOPE,
    domain: COWORK_OAUTH_LOCAL_DOMAIN,
  },
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Official d7 residual — org uuid from cookie value. */
export function parseCoworkOauthOrgUuid(
  value: string | null | undefined,
): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

/**
 * Official II residual — oauth environment selection.
 * Product: OAUTH_ENVIRONMENT when valid; else production.
 * Staging override only with explicit env (no invent).
 */
export function getCoworkOauthEnvironment(): CoworkOauthEnvironment {
  const raw = process.env.OAUTH_ENVIRONMENT;
  if (raw === "production" || raw === "staging" || raw === "local") {
    return raw;
  }
  if (raw) {
    console.warn(
      `[oauth] ignoring invalid OAUTH_ENVIRONMENT="%s", expected one of: %o`,
      raw,
      ["production", "staging", "local"],
    );
  }
  const claudeAiUrl = process.env.CLAUDE_AI_URL;
  if (
    typeof claudeAiUrl === "string" &&
    (claudeAiUrl.startsWith("http://localhost:") ||
      claudeAiUrl.includes(".staging.ant.dev"))
  ) {
    return "staging";
  }
  return "production";
}

/**
 * Official THe residual — cookie domain for lastActiveOrg / sessionKey.
 * Default `.claude.ai`; localhost when OAUTH env / CLAUDE_AI_URL local.
 */
export function getCoworkOauthCookieDomain(): string {
  const env = getCoworkOauthEnvironment();
  if (env === "local" || env === "staging") {
    // Official staging often uses localhost domain residual for cookie host.
    const claudeAiUrl = process.env.CLAUDE_AI_URL;
    if (
      typeof claudeAiUrl === "string" &&
      claudeAiUrl.includes(".staging.ant.dev")
    ) {
      return ".claude-ai.staging.ant.dev";
    }
    if (env === "local") return COWORK_OAUTH_LOCAL_DOMAIN;
    // staging default in h7 is RM localhost for cookie domain residual
    return COWORK_OAUTH_LOCAL_DOMAIN;
  }
  return COWORK_OAUTH_CLAUDE_AI_DOMAIN;
}

/**
 * Official kHe residual — cookie URL from domain.
 * localhost → main window / app url override; else https://{host without leading .}
 */
export function buildCoworkOauthCookieUrl(
  domain: string = getCoworkOauthCookieDomain(),
  localhostUrl?: string,
): string {
  if (domain === "localhost") {
    return (
      localhostUrl ||
      process.env.CLAUDE_AI_URL ||
      "http://localhost:5176"
    );
  }
  const host = domain.startsWith(".") ? domain.slice(1) : domain;
  return `https://${host}`;
}

/** Official Gm residual — overlay deployment apiHost when provided. */
export function applyCoworkOauthDeploymentHost(
  config: CoworkOauthConfig,
  apiHost?: string | null,
): CoworkOauthConfig {
  if (typeof apiHost === "string" && apiHost.length > 0) {
    return { ...config, apiHost };
  }
  return { ...config };
}

/** Official IIr config bag: COWORK env + sessions scope + optional host override. */
export function resolveCoworkSessionsBridgeOauthConfig(options?: {
  apiHost?: string | null;
  environment?: CoworkOauthEnvironment;
}): CoworkOauthConfig {
  const env = options?.environment ?? getCoworkOauthEnvironment();
  const base = COWORK_OAUTH_CONFIGS[env] ?? COWORK_OAUTH_CONFIGS.production;
  return applyCoworkOauthDeploymentHost(
    {
      ...base,
      scope: COWORK_SESSIONS_BRIDGE_OAUTH_SCOPE,
    },
    options?.apiHost,
  );
}
