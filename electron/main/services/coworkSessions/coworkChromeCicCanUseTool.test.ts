import { expect, it, vi } from "vitest";
import {
  denyCoworkCicBrowserUrl,
  resolveCoworkChromeCicCanUseTool,
} from "./coworkChromeCicCanUseTool";
import { COWORK_CHROME_MCP_TOOL_PREFIX } from "./coworkChromeCicHelpers";

const n5 = (short: string) => `${COWORK_CHROME_MCP_TOOL_PREFIX}${short}`;

it("non-CIC tool returns undefined", async () => {
  await expect(
    resolveCoworkChromeCicCanUseTool("Bash", {}, {
      hooks: {},
      session: {},
      sessionId: "s1",
    }),
  ).resolves.toBeUndefined();
});

it("permissionless K1e tools auto-allow", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("tabs_context_mcp"),
    { foo: 1 },
    { hooks: {}, session: {}, sessionId: "s1" },
  );
  expect(r).toEqual({ behavior: "allow", updatedInput: { foo: 1 } });
});

it("navigate history back/forward allows without prompt", async () => {
  for (const url of ["back", "FORWARD"]) {
    const r = await resolveCoworkChromeCicCanUseTool(
      n5("navigate"),
      { url },
      { hooks: {}, session: {}, sessionId: "s1" },
    );
    expect(r?.behavior).toBe("allow");
  }
});

it("computer wait allows", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("computer"),
    { action: "wait" },
    { hooks: {}, session: {}, sessionId: "s1" },
  );
  expect(r?.behavior).toBe("allow");
});

it("skip_all chrome mode auto-allows", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "https://example.com" },
    {
      hooks: {},
      session: {
        chromePermissionMode: "skip_all_permission_checks",
        permissionMode: "default",
      },
      sessionId: "s1",
      allowSkipAllOutsideUnsupervised: true,
    },
  );
  expect(r?.behavior).toBe("allow");
});

it("navigate non-web URL denies with exact message", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "chrome://settings" },
    { hooks: {}, session: {}, sessionId: "s1" },
  );
  expect(r).toEqual({
    behavior: "deny",
    message:
      "Can't interact with browser internal pages. Navigate to a web page first.",
  });
});

it("denyCoworkCicBrowserUrl messages match asar cBe", () => {
  expect(
    denyCoworkCicBrowserUrl("navigate", { ok: false, reason: "non-web" }, "x")
      .message,
  ).toContain("browser internal pages");
  expect(
    denyCoworkCicBrowserUrl(
      "navigate",
      { ok: false, reason: "unparseable" },
      "x",
    ).message,
  ).toContain("could not be parsed");
});

it("session grant auto-allows without card", async () => {
  const show = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "https://www.example.com/path" },
    {
      hooks: {
        showBrowserPermissionCard: show,
        queryTabUrl: async () => ({ url: "https://www.example.com/path" }),
      },
      session: {
        chromeAllowedDomains: ["example.com"],
      },
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("allow");
  expect(show).not.toHaveBeenCalled();
});

it("ext storage deny blocks", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "https://blocked.example" },
    {
      hooks: {
        queryTabUrl: async () => ({
          url: "https://blocked.example",
          storageDecision: "deny",
        }),
      },
      session: {},
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("deny");
  expect(r && "message" in r ? r.message : "").toContain("previously blocked");
});

it("ext storage allow updates follow_a_plan grant", async () => {
  const update = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "https://ok.example" },
    {
      hooks: {
        queryTabUrl: async () => ({
          url: "https://ok.example",
          storageDecision: "allow",
        }),
        updateChromePermission: update,
      },
      session: { chromeAllowedDomains: ["other.com"] },
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("allow");
  expect(update).toHaveBeenCalledWith(
    "follow_a_plan",
    expect.arrayContaining(["other.com", "ok.example"]),
  );
});

it("prompt always → follow_a_plan domain grant", async () => {
  const update = vi.fn();
  const setOnce = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("navigate"),
    { url: "https://prompt.example" },
    {
      hooks: {
        queryTabUrl: async () => ({ url: "https://prompt.example" }),
        showBrowserPermissionCard: async () => ({
          allowed: true,
          always: true,
          allSites: false,
        }),
        getSessionAfterPrompt: () => ({
          chromeAllowedDomains: [],
          permissionMode: "default",
        }),
        updateChromePermission: update,
        setCicOnceApproved: setOnce,
      },
      session: {},
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("allow");
  expect(update).toHaveBeenCalledWith("follow_a_plan", ["prompt.example"]);
  expect(setOnce).not.toHaveBeenCalled();
});

it("prompt once → setCicOnceApproved", async () => {
  const setOnce = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("click"),
    { tabId: 3 },
    {
      hooks: {
        queryTabUrl: async () => ({ url: "https://once.example" }),
        showBrowserPermissionCard: async () => ({
          allowed: true,
          always: false,
          allSites: false,
        }),
        getSessionAfterPrompt: () => ({}),
        setCicOnceApproved: setOnce,
      },
      session: {},
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("allow");
  expect(setOnce).toHaveBeenCalledWith("once.example");
});

it("browser_batch denies on sub-action deny and clears once", async () => {
  const clear = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("browser_batch"),
    {
      actions: [
        { name: "tabs_context_mcp", input: {} },
        { name: "navigate", input: { url: "chrome://x" } },
      ],
    },
    {
      hooks: { clearCicOnceApproved: clear },
      session: {},
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("deny");
  expect(clear).toHaveBeenCalled();
});

it("select_browser same device allows without card", async () => {
  const show = vi.fn();
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("select_browser"),
    { deviceId: "abc12345xxxx" },
    {
      hooks: {
        getCurrentBrowserDeviceId: () => "abc12345xxxx",
        showBrowserPermissionCard: show,
      },
      session: {},
      sessionId: "s1",
    },
  );
  expect(r?.behavior).toBe("allow");
  expect(show).not.toHaveBeenCalled();
});

it("missing queryTabUrl for tabId denies unavailable", async () => {
  const r = await resolveCoworkChromeCicCanUseTool(
    n5("click"),
    { tabId: 9 },
    { hooks: {}, session: {}, sessionId: "s1" },
  );
  expect(r).toEqual({
    behavior: "deny",
    message: "Browser connection is unavailable. You can try again.",
  });
});
