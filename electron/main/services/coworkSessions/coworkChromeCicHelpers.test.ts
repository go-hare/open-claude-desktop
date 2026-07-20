import { expect, it } from "vitest";
import {
  COWORK_CHROME_MCP_SERVER_NAME,
  COWORK_CHROME_MCP_TOOL_PREFIX,
  COWORK_CHROME_PERMISSIONLESS_TOOLS,
  buildCoworkBrowserPermissionToolRequest,
  coworkChromeMcpToolShortName,
  isCoworkChromeMcpToolName,
  isCoworkChromePermissionlessTool,
  isCoworkHiddenSessionType,
  mapCoworkBrowserPermissionResult,
  normalizeCoworkChromeDomainHost,
  parseCoworkChromeBrowserUrl,
  resolveCoworkPermissionSessionId,
  resolveCoworkK2AllowSkipAllOutsideUnsupervised,
  resolveCoworkStartChromeSeed,
  resolveEffectiveCoworkChromePermissionMode,
  stripCoworkChromeWwwPrefix,
} from "./coworkChromeCicHelpers";

it("constants match official Lai/N5/K1e", () => {
  expect(COWORK_CHROME_MCP_SERVER_NAME).toBe("Claude_in_Chrome");
  expect(COWORK_CHROME_MCP_TOOL_PREFIX).toBe("mcp__Claude_in_Chrome__");
  expect([...COWORK_CHROME_PERMISSIONLESS_TOOLS].sort()).toEqual(
    [
      "gif_creator",
      "list_connected_browsers",
      "resize_window",
      "shortcuts_execute",
      "shortcuts_list",
      "switch_browser",
      "tabs_close_mcp",
      "tabs_context_mcp",
      "tabs_create_mcp",
    ].sort(),
  );
});

it("K2 resolveCoworkK2AllowSkipAllOutsideUnsupervised from account isRaven", () => {
  // Official: no account → false
  expect(resolveCoworkK2AllowSkipAllOutsideUnsupervised(null)).toBe(false);
  expect(resolveCoworkK2AllowSkipAllOutsideUnsupervised(undefined)).toBe(false);
  expect(
    resolveCoworkK2AllowSkipAllOutsideUnsupervised({ isLoggedOut: true }),
  ).toBe(false);
  expect(
    resolveCoworkK2AllowSkipAllOutsideUnsupervised({
      accountUuid: undefined,
      isLoggedOut: false,
    }),
  ).toBe(false);
  // isRaven undefined → ?? true → K2 false
  expect(
    resolveCoworkK2AllowSkipAllOutsideUnsupervised({
      accountUuid: "a1",
      isLoggedOut: false,
    }),
  ).toBe(false);
  // isRaven true → false
  expect(
    resolveCoworkK2AllowSkipAllOutsideUnsupervised({
      accountUuid: "a1",
      isLoggedOut: false,
      isRaven: true,
    }),
  ).toBe(false);
  // isRaven false → true (non-raven)
  expect(
    resolveCoworkK2AllowSkipAllOutsideUnsupervised({
      accountUuid: "a1",
      isLoggedOut: false,
      isRaven: false,
    }),
  ).toBe(true);
});

it("E_ resolveEffectiveCoworkChromePermissionMode", () => {
  // unsupervised: keep chrome mode including skip_all
  expect(
    resolveEffectiveCoworkChromePermissionMode(
      "skip_all_permission_checks",
      "auto",
      false,
    ),
  ).toBe("skip_all_permission_checks");
  expect(
    resolveEffectiveCoworkChromePermissionMode(
      "ask",
      "bypassPermissions",
      false,
    ),
  ).toBe("ask");

  // supervised + skip_all + !K2 → undefined
  expect(
    resolveEffectiveCoworkChromePermissionMode(
      "skip_all_permission_checks",
      "default",
      false,
    ),
  ).toBeUndefined();

  // supervised + skip_all + K2 → keep
  expect(
    resolveEffectiveCoworkChromePermissionMode(
      "skip_all_permission_checks",
      "default",
      true,
    ),
  ).toBe("skip_all_permission_checks");

  // supervised + non-skip always returns mode
  expect(
    resolveEffectiveCoworkChromePermissionMode("follow_a_plan", "acceptEdits"),
  ).toBe("follow_a_plan");
  expect(
    resolveEffectiveCoworkChromePermissionMode(undefined, "default"),
  ).toBeUndefined();
});

it("gBe parseCoworkChromeBrowserUrl", () => {
  expect(parseCoworkChromeBrowserUrl("chrome://settings")).toEqual({
    ok: false,
    reason: "non-web",
  });
  expect(parseCoworkChromeBrowserUrl("file:///tmp/x")).toEqual({
    ok: false,
    reason: "non-web",
  });
  expect(parseCoworkChromeBrowserUrl("example.com")).toEqual({
    ok: true,
    cardUrl: "https://example.com",
    host: "example.com",
  });
  expect(parseCoworkChromeBrowserUrl("https://foo.bar:8443/path")).toEqual({
    ok: true,
    cardUrl: "https://foo.bar:8443/path",
    host: "foo.bar:8443",
  });
  expect(parseCoworkChromeBrowserUrl("not a url ::")).toEqual({
    ok: false,
    reason: "unparseable",
  });
});

it("cLi mapCoworkBrowserPermissionResult", () => {
  expect(
    mapCoworkBrowserPermissionResult({ behavior: "deny" }),
  ).toEqual({ allowed: false, always: false, allSites: false });

  expect(
    mapCoworkBrowserPermissionResult({
      behavior: "allow",
      updatedInput: { _allowAllSites: true },
    }),
  ).toEqual({ allowed: true, always: false, allSites: true });

  expect(
    mapCoworkBrowserPermissionResult({
      behavior: "allow",
      updatedPermissions: [{ type: "addRules" }],
      updatedInput: {},
    }),
  ).toEqual({ allowed: true, always: true, allSites: false });

  // allSites wins over always
  expect(
    mapCoworkBrowserPermissionResult({
      behavior: "allow",
      updatedPermissions: [{ type: "addRules" }],
      updatedInput: { _allowAllSites: true },
    }),
  ).toEqual({ allowed: true, always: false, allSites: true });

  // allow without rules → always false
  expect(
    mapCoworkBrowserPermissionResult({
      behavior: "allow",
      updatedPermissions: [],
    }),
  ).toEqual({ allowed: true, always: false, allSites: false });
});

it("gLi buildCoworkBrowserPermissionToolRequest + nXi + iv", () => {
  const built = buildCoworkBrowserPermissionToolRequest({
    toolType: "navigate",
    url: "https://www.example.com/path?q=1",
    actionData: { deviceId: "abc", _allowAllSites: true, foo: 1 },
  });
  expect(built.toolName).toBe("browser:navigate");
  expect(built.input).toEqual({
    deviceId: "abc",
    foo: 1,
    domain: "www.example.com",
  });
  expect(built.input).not.toHaveProperty("_allowAllSites");
  expect(built.suggestions).toEqual([
    {
      type: "addRules",
      rules: [{ toolName: "browser:navigate" }],
      behavior: "allow",
      destination: "session",
    },
  ]);

  // Invalid URL keeps raw string as domain.
  expect(
    buildCoworkBrowserPermissionToolRequest({
      toolType: "click",
      url: "not a url",
    }).input.domain,
  ).toBe("not a url");

  // nXi: dispatch_child → live parent; archived parent falls back; plain id.
  const sessions = new Map<
    string,
    {
      lifecycleState?: string;
      parentSessionId?: string;
      sessionType?: string;
    }
  >([
    [
      "parent",
      { sessionType: "agent", lifecycleState: "running" },
    ],
    [
      "child",
      {
        sessionType: "dispatch_child",
        parentSessionId: "parent",
        lifecycleState: "running",
      },
    ],
    [
      "orphan",
      {
        sessionType: "dispatch_child",
        parentSessionId: "gone",
        lifecycleState: "running",
      },
    ],
    [
      "arch-parent",
      { sessionType: "agent", lifecycleState: "archived" },
    ],
    [
      "arch-child",
      {
        sessionType: "dispatch_child",
        parentSessionId: "arch-parent",
        lifecycleState: "running",
      },
    ],
  ]);
  const get = (id: string) => sessions.get(id);
  expect(resolveCoworkPermissionSessionId(get, "child")).toBe("parent");
  expect(resolveCoworkPermissionSessionId(get, "orphan")).toBe("orphan");
  expect(resolveCoworkPermissionSessionId(get, "arch-child")).toBe(
    "arch-child",
  );
  expect(resolveCoworkPermissionSessionId(get, "parent")).toBe("parent");
  expect(resolveCoworkPermissionSessionId(get, "missing")).toBe("missing");

  expect(isCoworkHiddenSessionType("agent")).toBe(true);
  expect(isCoworkHiddenSessionType("dispatch_child")).toBe(true);
  expect(isCoworkHiddenSessionType("radar")).toBe(true);
  expect(isCoworkHiddenSessionType("scheduled")).toBe(false);
  expect(isCoworkHiddenSessionType(undefined)).toBe(false);
});

it("H1/Ice domain normalize + tool name helpers", () => {
  expect(stripCoworkChromeWwwPrefix("www.example.com")).toBe("example.com");
  expect(normalizeCoworkChromeDomainHost("www.example.com:443")).toBe(
    "example.com",
  );
  expect(isCoworkChromeMcpToolName("mcp__Claude_in_Chrome__navigate")).toBe(
    true,
  );
  expect(isCoworkChromeMcpToolName("mcp__other__navigate")).toBe(false);
  expect(coworkChromeMcpToolShortName("mcp__Claude_in_Chrome__navigate")).toBe(
    "navigate",
  );
  expect(isCoworkChromePermissionlessTool("tabs_context_mcp")).toBe(true);
  expect(isCoworkChromePermissionlessTool("navigate")).toBe(false);
});

it("resolveCoworkStartChromeSeed K2+gi+scheduled+unsupervised", () => {
  // m only when K2 && allowAll
  expect(
    resolveCoworkStartChromeSeed({
      allowAllBrowserActions: true,
      allowSkipAllOutsideUnsupervised: false,
    }),
  ).toEqual({
    chromePermissionMode: undefined,
    chromeAllowedDomains: undefined,
  });
  expect(
    resolveCoworkStartChromeSeed({
      allowAllBrowserActions: true,
      allowSkipAllOutsideUnsupervised: true,
    }),
  ).toEqual({
    chromePermissionMode: "skip_all_permission_checks",
    chromeAllowedDomains: undefined,
  });

  // scheduled mode via E_(mode) with K2 false suppresses skip_all
  expect(
    resolveCoworkStartChromeSeed({
      allowSkipAllOutsideUnsupervised: false,
      scheduledChrome: {
        mode: "skip_all_permission_checks",
        domains: ["s.com"],
      },
    }),
  ).toEqual({
    chromePermissionMode: undefined,
    chromeAllowedDomains: ["s.com"],
  });
  expect(
    resolveCoworkStartChromeSeed({
      allowSkipAllOutsideUnsupervised: true,
      scheduledChrome: {
        mode: "follow_a_plan",
        domains: ["s.com"],
      },
    }),
  ).toEqual({
    chromePermissionMode: "follow_a_plan",
    chromeAllowedDomains: ["s.com"],
  });

  // unsupervised: snapshot base; chromeSkipAll overrides mode/domains
  const unsupervised = resolveCoworkStartChromeSeed({
    allowAllBrowserActions: true,
    allowSkipAllOutsideUnsupervised: true,
    chromeSkipAllPermissionChecks: true,
    permissionMode: "auto",
    scheduledChrome: { mode: "ask", domains: ["a.com"] },
  });
  expect(unsupervised.chromePermissionMode).toBe("skip_all_permission_checks");
  expect(unsupervised.chromeAllowedDomains).toBeUndefined();
  expect(unsupervised.chromePermsBeforeUnsupervised).toEqual({
    mode: "ask",
    domains: ["a.com"],
  });

  const unsupervisedFalse = resolveCoworkStartChromeSeed({
    allowSkipAllOutsideUnsupervised: true,
    chromeSkipAllPermissionChecks: false,
    permissionMode: "bypassPermissions",
    scheduledChrome: { mode: "ask", domains: ["b.com"] },
  });
  expect(unsupervisedFalse.chromePermissionMode).toBeUndefined();
  expect(unsupervisedFalse.chromeAllowedDomains).toBeUndefined();
  expect(unsupervisedFalse.chromePermsBeforeUnsupervised).toEqual({
    mode: "ask",
    domains: ["b.com"],
  });
});
