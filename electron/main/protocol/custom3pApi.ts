import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net } from "electron";
import { JSON_HEADERS, THIRD_PARTY_NOT_AVAILABLE_BODY } from "./constants";
import { isApiLikePath, normalizeApiPath } from "./apiPath";
import { resolveInsideRoot } from "./safePath";

export type BootstrapPayload = Record<string, unknown> & {
  system_prompts?: unknown;
};

type BootstrapModel = {
  id: string;
  name: string;
};

type ThirdPartyBootstrapConfig = {
  provider?: string;
  orgUuid?: string;
  models?: BootstrapModel[];
  supports1mContextModels?: string[];
};

export type Custom3pApiOptions = {
  ionDistRoot: string;
  bootstrap?: BootstrapPayload | (() => Promise<BootstrapPayload> | BootstrapPayload);
  installId?: string;
  readAccountSettings?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  upstreamBaseUrl?: string;
  egressRules?: Array<{ host: string; path?: string; pathSuffix?: string; followRedirects?: boolean }>;
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS, ...init });
}

function emptyObject(): Response {
  return json({});
}

function emptyPluginList(): Response {
  return json({ plugins: [], has_more: false });
}

function emptyMarketplaceList(): Response {
  return json({ marketplaces: [] });
}

function custom3pUnavailable(): Response {
  return new Response(THIRD_PARTY_NOT_AVAILABLE_BODY, { status: 503, headers: JSON_HEADERS });
}

const DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";
const DEFAULT_ORG_UUID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_INSTALL_ID = "00000000-0000-4000-8000-000000000002";

const FEATURE_FLAGS: Record<string, unknown> = {
  574905726: { defaultValue: true },
  954625922: { defaultValue: true },
  "3140074548": { defaultValue: true },
  986399546: { defaultValue: true },
  "2895944283": { defaultValue: true },
  "2223451630": { defaultValue: true },
  "2547348043": { defaultValue: true },
  "4085357330": { defaultValue: true },
  "3368286709": { defaultValue: true },
  "3615229285": { defaultValue: true },
  "3353525254": { defaultValue: true },
  "3356268835": {
    defaultValue: { showGsuiteConnectors: false, enableAdditionalDirectoriesClaudeMd: true },
  },
  1868684740: { defaultValue: true },
  1543157067: { defaultValue: true },
  "4108768567": { defaultValue: true },
  "3070110303": { defaultValue: true },
};

function defaultBootstrapConfig(value: BootstrapPayload | undefined): Required<ThirdPartyBootstrapConfig> {
  const record = (value ?? {}) as ThirdPartyBootstrapConfig;
  const models = Array.isArray(record.models) && record.models.length > 0
    ? record.models
    : [{ id: "deepseek-chat", name: "DeepSeek Chat" }];
  return {
    provider: typeof record.provider === "string" ? record.provider : "gateway",
    orgUuid: typeof record.orgUuid === "string" ? record.orgUuid : DEFAULT_ORG_UUID,
    models,
    supports1mContextModels: Array.isArray(record.supports1mContextModels) ? record.supports1mContextModels : [],
  };
}

function modelFeatureConfig(config: Required<ThirdPartyBootstrapConfig>): Record<string, unknown> {
  const modelIds = config.models.map((model) => model.id);
  const defaultModel = modelIds[0] ?? "";
  const allowedModels = [...new Set([...modelIds, ...config.supports1mContextModels.map((model) => `${model}[1m]`)])];
  return {
    ...FEATURE_FLAGS,
    1736264167: {
      defaultValue: {
        allowed_models: allowedModels,
        model: defaultModel,
        supports_1m_context: config.supports1mContextModels,
      },
    },
    "3110209724": {
      defaultValue: {
        allowed_models: allowedModels,
        model: defaultModel,
        supports_1m_context: config.supports1mContextModels,
      },
    },
    "2973881027": {
      defaultValue: {
        model: defaultModel,
        overrideSticky: false,
        nuxId: null,
      },
    },
  };
}

function createOrganization(config: Required<ThirdPartyBootstrapConfig>): Record<string, unknown> {
  return {
    uuid: config.orgUuid,
    id: 0,
    name: config.provider === "gateway" ? "Gateway" : config.provider,
    settings: {},
    parent_organization_uuid: null,
    capabilities: ["chat", "claude_pro"],
    billing_type: "stripe_subscription",
    free_credits_status: null,
    api_disabled_reason: null,
    api_disabled_until: null,
    rate_limit_tier: null,
    data_retention: null,
    raven_type: null,
    claude_ai_bootstrap_models_config: config.models.map((model) => ({ model: model.id, name: model.name })),
  };
}

function createThirdPartyBootstrap(value: BootstrapPayload | undefined, accountSettings: Record<string, unknown>, installId: string): BootstrapPayload {
  if (value?.account && value?.statsig && value?.growthbook) return { ...value, account_settings: accountSettings };

  const config = defaultBootstrapConfig(value);
  const identity = (accountSettings.__account_identity ?? {}) as Record<string, unknown>;
  const profile = (accountSettings.__account_profile ?? {}) as Record<string, unknown>;
  const settings = Object.fromEntries(Object.entries(accountSettings).filter(([key]) => !key.startsWith("__")));
  const membership = {
    role: "admin",
    seat_tier: "unassigned",
    created_at: DEFAULT_CREATED_AT,
    updated_at: DEFAULT_CREATED_AT,
    organization: createOrganization(config),
  };

  return {
    account: {
      tagged_id: `cowork_3p_${installId}`,
      uuid: installId,
      email_address: "cowork-3p@localhost",
      full_name: typeof identity.full_name === "string" ? identity.full_name : "Claude-Deepseek",
      display_name: typeof identity.display_name === "string" ? identity.display_name : "Claude-Deepseek",
      created_at: DEFAULT_CREATED_AT,
      updated_at: DEFAULT_CREATED_AT,
      accepted_clickwrap_versions: {},
      is_verified: true,
      age_is_verified: true,
      memberships: [membership],
      workspace_memberships: [],
      invites: [],
      settings: { ...settings, enabled_geolocation: false },
    },
    locale: typeof profile.locale === "string" ? profile.locale : null,
    statsig: { user: { userID: installId }, values: {}, values_hash: "custom3p" },
    growthbook: { features: modelFeatureConfig(config) },
    intercom_account_hash: null,
    system_prompts: {
      cowork_system_prompt: {
        value: { prompt: "" },
        on: true,
        off: false,
        source: "defaultValue",
        ruleId: null,
      },
    },
    account_settings: accountSettings,
    ...(value ?? {}),
  };
}

async function getBootstrap(
  options: Custom3pApiOptions,
  runtimeAccountSettings: Record<string, unknown> = {},
): Promise<BootstrapPayload> {
  const value = typeof options.bootstrap === "function" ? await options.bootstrap() : options.bootstrap;
  const persisted = options.readAccountSettings ? await options.readAccountSettings() : {};
  // Official personal settings mutate account.settings via PATCH /api/account/settings and
  // identity via PUT /api/account. Runtime handler state must win over disk defaults so
  // bootstrap reflects in-session updates (c0db37792 profile + cc989143e PR settings).
  return createThirdPartyBootstrap(value, { ...persisted, ...runtimeAccountSettings }, options.installId ?? DEFAULT_INSTALL_ID);
}

function matchEgressRule(hostname: string, pathname: string, options: Custom3pApiOptions) {
  return options.egressRules?.find((rule) => {
    const hostMatches = rule.host.startsWith("*.") ? hostname.endsWith(rule.host.slice(1)) : hostname === rule.host;
    if (!hostMatches) return false;
    if (rule.path && !pathname.startsWith(rule.path)) return false;
    if (rule.pathSuffix && !pathname.endsWith(rule.pathSuffix)) return false;
    return true;
  });
}

async function fetchI18nFile(root: string, pathname: string): Promise<Response> {
  const filePath = resolveInsideRoot(root, pathname);
  if (!filePath) return emptyObject();
  try {
    if ((await fs.stat(filePath)).isFile()) return net.fetch(pathToFileURL(filePath).href);
  } catch {}
  return emptyObject();
}

/** Original `frr(ionDistPath, discoveredRendererConfig)` equivalent for the local third-party desktop mode. */
export function createCustom3pApiHandler(options: Custom3pApiOptions) {
  const root = path.resolve(options.ionDistRoot);
  const installId = options.installId ?? DEFAULT_INSTALL_ID;
  let accountSettings: Record<string, unknown> = {};

  const readAccountSettings = async () => ({
    ...(options.readAccountSettings ? await options.readAccountSettings() : {}),
    ...accountSettings,
  });
  const writeAccountSettings = async (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
    accountSettings = updater(await readAccountSettings());
    return accountSettings;
  };
  const currentBootstrap = async () => getBootstrap(options, accountSettings);

  return async function handleCustom3pApi(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    const pathname = normalizeApiPath(url.pathname);

    if (options.upstreamBaseUrl && isApiLikePath(pathname)) {
      const upstream = new URL(options.upstreamBaseUrl);
      const rule = matchEgressRule(upstream.hostname, pathname, options);
      if (rule) {
        upstream.pathname = pathname;
        upstream.search = url.search;
        return net.fetch(upstream.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.body,
          bypassCustomProtocolHandlers: true,
          redirect: rule.followRedirects ? "follow" : "manual",
          duplex: "half",
        } as RequestInit);
      }
    }

    if (pathname === "/api/bootstrap" || pathname.endsWith("/app_start")) return json(await currentBootstrap());
    if (pathname.startsWith("/api/bootstrap/") && pathname.endsWith("/system_prompts")) return json((await currentBootstrap()).system_prompts ?? {});
    if (pathname === "/api/account") {
      if (request.method === "GET") return json(await currentBootstrap());
      if (request.method !== "PUT") return new Response(null, { status: 405 });
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const next = await writeAccountSettings((current) => ({
        ...current,
        __account_identity: {
          ...((current.__account_identity ?? {}) as Record<string, unknown>),
          ...(body.full_name !== undefined ? { full_name: body.full_name } : {}),
          ...(body.display_name !== undefined ? { display_name: body.display_name } : {}),
        },
      }));
      return json(await getBootstrap(options, next));
    }
    if (pathname === "/api/account_profile") {
      const profile = ((await readAccountSettings()).__account_profile ?? {}) as Record<string, unknown>;
      if (request.method === "GET") return json({ locale: null, ...profile });
      if (request.method !== "PUT" && request.method !== "PATCH") return new Response(null, { status: 405 });
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      await writeAccountSettings((current) => ({
        ...current,
        __account_profile: { ...((current.__account_profile ?? {}) as Record<string, unknown>), ...body },
        // Official profile fields (avatar / work_function / conversation_preferences) also surface on account.settings.
        ...Object.fromEntries(
          Object.entries(body).filter(([key]) =>
            key === "avatar" || key === "work_function" || key === "conversation_preferences",
          ),
        ),
      }));
      return emptyObject();
    }
    if (pathname === "/api/account/settings") {
      if (request.method === "GET") {
        const settings = await readAccountSettings();
        return json(Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith("__"))));
      }
      if (request.method !== "PATCH" && request.method !== "PUT") return new Response(null, { status: 405 });
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      await writeAccountSettings((current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(body).filter(([key]) => !key.startsWith("__"))),
      }));
      return json({}, { status: 202 });
    }
    if (pathname.startsWith("/api/organizations/") && pathname.endsWith("/notification/preferences")) {
      const current = await readAccountSettings();
      const preferences = ((current.__notification_preferences ?? {}) as Record<string, unknown>);
      if (request.method === "GET") return json({ account_id: 0, organization_id: 0, preferences });
      if (request.method !== "PUT" && request.method !== "PATCH") return new Response(null, { status: 405 });
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const requested = (body.preferences ?? {}) as Record<string, unknown>;
      const nextPreferences = request.method === "PUT"
        ? requested
        : {
            ...preferences,
            ...requested,
            feature_preference: {
              ...((preferences.feature_preference ?? {}) as Record<string, unknown>),
              ...((requested.feature_preference ?? {}) as Record<string, unknown>),
            },
          };
      await writeAccountSettings((settings) => ({ ...settings, __notification_preferences: nextPreferences }));
      return json({ account_id: 0, organization_id: 0, preferences: nextPreferences });
    }
    if (pathname.startsWith("/api/organizations/") && pathname.endsWith("/notification/channels")) return emptyObject();
    if (pathname === "/api/account/bootstrap") return json(await currentBootstrap());
    if (pathname.includes("/individual_plan_pricing")) {
      return json({
        currency: "USD",
        plans: [],
        individual_plan_pricing: [],
      });
    }
    if (pathname.endsWith("/plugins/list-plugins")) return emptyPluginList();
    if (pathname.endsWith("/marketplaces/list-default-marketplaces") || pathname.endsWith("/marketplaces/list-account-marketplaces") || pathname.endsWith("/marketplaces/list-org-marketplaces")) return emptyMarketplaceList();
    if (pathname.includes("/dxt/extensions")) {
      if (/\/dxt\/extensions\/[^/]+\/versions\/[^/]+$/.test(pathname)) return json({});
      if (/\/dxt\/extensions\/[^/]+\/versions$/.test(pathname)) return json({ versions: [] });
      if (/\/dxt\/extensions\/[^/]+$/.test(pathname)) return json({});
      return json({ extensions: [], has_more: false });
    }
    if (pathname.endsWith("/dust/command_display_names")) return json({ results: [] });
    if (pathname.endsWith("/dust/generate_session_title")) return json({ title: "" });
    if (pathname.endsWith("/dust/generate_title_and_branch")) return json({ title: "" });
    if (pathname === "/healthcheck") return json({ status: "healthy", timestamp: new Date().toISOString() });
    if (pathname.startsWith("/i18n/")) return fetchI18nFile(root, new URL(request.url).pathname);
    if (pathname.startsWith("/v1/code/github/")) return json({ branch_statuses: [] });

    if (isApiLikePath(pathname)) return custom3pUnavailable();
    return undefined;
  };
}
