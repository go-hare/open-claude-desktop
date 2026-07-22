import { expect, it } from "vitest";
import { createCustom3pApiHandler } from "./custom3pApi";

it("publishes the persisted install identity through every bootstrap identity field", async () => {
  const installId = "66666666-6666-4666-8666-666666666666";
  const handle = createCustom3pApiHandler({ installId, ionDistRoot: process.cwd() });
  const response = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await response?.json()) as {
    account: { tagged_id: string; uuid: string };
    statsig: { user: { userID: string } };
  };

  expect(payload.account).toMatchObject({
    tagged_id: `cowork_3p_${installId}`,
    uuid: installId,
  });
  expect(payload.statsig.user.userID).toBe(installId);
});

it("merges runtime account settings into bootstrap after PATCH /api/account/settings", async () => {
  const handle = createCustom3pApiHandler({ installId: "77777777-7777-4777-8777-777777777777", ionDistRoot: process.cwd() });
  const patch = await handle(
    new Request("app://localhost/api/account/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccr_auto_create_pr_on_push: true, ccr_auto_create_pr_as_draft: false }),
    }),
  );
  expect(patch?.status).toBe(202);

  const settings = await handle(new Request("app://localhost/api/account/settings"));
  const settingsBody = (await settings?.json()) as Record<string, unknown>;
  expect(settingsBody.ccr_auto_create_pr_on_push).toBe(true);
  expect(settingsBody.ccr_auto_create_pr_as_draft).toBe(false);

  const bootstrap = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await bootstrap?.json()) as {
    account: { settings: Record<string, unknown> };
  };
  expect(payload.account.settings.ccr_auto_create_pr_on_push).toBe(true);
  expect(payload.account.settings.ccr_auto_create_pr_as_draft).toBe(false);
});

it("persists identity + profile fields through PUT account and account_profile", async () => {
  const handle = createCustom3pApiHandler({ installId: "88888888-8888-4888-8888-888888888888", ionDistRoot: process.cwd() });
  const putAccount = await handle(
    new Request("app://localhost/api/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: "Ada Lovelace", display_name: "Ada" }),
    }),
  );
  const accountBody = (await putAccount?.json()) as {
    account: { full_name: string; display_name: string };
  };
  expect(accountBody.account.full_name).toBe("Ada Lovelace");
  expect(accountBody.account.display_name).toBe("Ada");

  await handle(
    new Request("app://localhost/api/account_profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar: 12,
        work_function: "Engineering",
        conversation_preferences: "Be concise",
      }),
    }),
  );

  const bootstrap = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await bootstrap?.json()) as {
    account: { full_name: string; display_name: string; settings: Record<string, unknown> };
  };
  expect(payload.account.full_name).toBe("Ada Lovelace");
  expect(payload.account.display_name).toBe("Ada");
  expect(payload.account.settings.avatar).toBe(12);
  expect(payload.account.settings.work_function).toBe("Engineering");
  expect(payload.account.settings.conversation_preferences).toBe("Be concise");
});

it("persists preview_feature_uses_artifacts and browser_extension_settings on account/settings", async () => {
  const handle = createCustom3pApiHandler({ installId: "99999999-9999-4999-8999-999999999999", ionDistRoot: process.cwd() });
  const patch = await handle(
    new Request("app://localhost/api/account/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preview_feature_uses_artifacts: false,
        browser_extension_settings: {
          enabled: true,
          default_domain_policy: "block",
          allowed_domains: ["example.com"],
          blocked_domains: [],
        },
      }),
    }),
  );
  expect(patch?.status).toBe(202);

  const bootstrap = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await bootstrap?.json()) as {
    account: { settings: Record<string, unknown> };
  };
  expect(payload.account.settings.preview_feature_uses_artifacts).toBe(false);
  expect(payload.account.settings.browser_extension_settings).toEqual({
    enabled: true,
    default_domain_policy: "block",
    allowed_domains: ["example.com"],
    blocked_domains: [],
  });
});

it("persists Capabilities account keys used by GrowthBook residual arms", async () => {
  const handle = createCustom3pApiHandler({
    installId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ionDistRoot: process.cwd(),
  });
  const patch = await handle(
    new Request("app://localhost/api/account/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled_saffron_search: true,
        enabled_saffron: true,
        tool_search_mode: "on",
        enabled_gdrive_indexing: true,
        enabled_mcp_tools: { inline_visualizations: true },
        enabled_turmeric: true,
      }),
    }),
  );
  expect(patch?.status).toBe(202);

  const bootstrap = await handle(new Request("app://localhost/api/bootstrap"));
  const payload = (await bootstrap?.json()) as {
    account: { settings: Record<string, unknown> };
    growthbook: { features: Record<string, unknown> };
  };
  expect(payload.account.settings.enabled_saffron_search).toBe(true);
  expect(payload.account.settings.enabled_saffron).toBe(true);
  expect(payload.account.settings.tool_search_mode).toBe("on");
  expect(payload.account.settings.enabled_gdrive_indexing).toBe(true);
  expect(payload.account.settings.enabled_mcp_tools).toEqual({ inline_visualizations: true });
  expect(payload.growthbook.features.chat_follow_up_chips_main).toEqual({ defaultValue: true });
  expect(payload.growthbook.features.cai_opt_in_connector_suggestions).toEqual({ defaultValue: true });
});

it("lists local dxt/MCP inventory when userData + mcp config provided", async () => {
  const handle = createCustom3pApiHandler({
    installId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ionDistRoot: process.cwd(),
    getUserDataPath: () => "/tmp/hare-code-custom3p-dxt-test-missing",
    getMcpServersConfig: () => ({
      "local-fs": { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
    }),
  });
  const response = await handle(new Request("app://localhost/api/organizations/local/dxt/extensions"));
  const body = (await response?.json()) as { extensions: Array<Record<string, unknown>> };
  expect(Array.isArray(body.extensions)).toBe(true);
  expect(body.extensions.some((item) => item.id === "mcp-local-fs")).toBe(true);
});

it("serializes concurrent account/settings PATCH so keys are not clobbered", async () => {
  const handle = createCustom3pApiHandler({
    installId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ionDistRoot: process.cwd(),
  });
  await Promise.all([
    handle(
      new Request("app://localhost/api/account/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_saffron_search: true }),
      }),
    ),
    handle(
      new Request("app://localhost/api/account/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled_saffron: true }),
      }),
    ),
    handle(
      new Request("app://localhost/api/account/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_search_mode: "on" }),
      }),
    ),
  ]);
  const settings = await handle(new Request("app://localhost/api/account/settings"));
  const body = (await settings?.json()) as Record<string, unknown>;
  expect(body.enabled_saffron_search).toBe(true);
  expect(body.enabled_saffron).toBe(true);
  expect(body.tool_search_mode).toBe("on");
});
