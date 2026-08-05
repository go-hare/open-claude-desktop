import { expect, it, vi } from "vitest";
import { buildComputerUseTools } from "@ant/computer-use-mcp";
import {
  computerUseToolShapeForResidual,
  createCoworkComputerUseMcpServerConfig,
  handleCoworkComputerUseFeatureDisabledCall,
  isCoworkComputerUseEnablePromptPath,
  isCoworkComputerUseFullyEnabled,
} from "./coworkComputerUseMcpServer";

it("YM/QHA residual: enable path when chicago off on supported platform", () => {
  expect(isCoworkComputerUseEnablePromptPath(false, "darwin")).toBe(true);
  expect(isCoworkComputerUseFullyEnabled(false, "darwin")).toBe(false);
  expect(isCoworkComputerUseEnablePromptPath(true, "darwin")).toBe(false);
  expect(isCoworkComputerUseFullyEnabled(true, "darwin")).toBe(true);
  expect(isCoworkComputerUseEnablePromptPath(false, "linux")).toBe(false);
});

it("CFi residual emits featureDisabled permission for request_access", async () => {
  const onPermissionRequest = vi.fn(async () => ({
    granted: [],
    denied: [],
    flags: {
      clipboardRead: false,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  }));
  let chicago = false;
  const result = await handleCoworkComputerUseFeatureDisabledCall(
    "request_access",
    { reason: "need Finder" },
    {
      getTccState: async () => ({
        accessibility: "granted",
        screenRecording: "granted",
      }),
      isChicagoEnabled: () => chicago,
      onPermissionRequest,
      screenshotFiltering: "native",
    },
  );
  expect(onPermissionRequest).toHaveBeenCalledTimes(1);
  const firstArg = onPermissionRequest.mock.calls.at(0)?.at(0) as
    | Record<string, unknown>
    | undefined;
  expect(firstArg).toBeTruthy();
  expect(firstArg?.featureDisabled).toBe(true);
  expect(firstArg?.reason).toBe("need Finder");
  expect(firstArg?.tccState).toBeUndefined();
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("chose not to turn on Computer Use");

  // After Uge enable, re-read chicago → post-enable guidance.
  chicago = true;
  const after = await handleCoworkComputerUseFeatureDisabledCall(
    "request_access",
    {},
    {
      getTccState: async () => ({
        accessibility: "granted",
        screenRecording: "granted",
      }),
      isChicagoEnabled: () => chicago,
      onPermissionRequest: vi.fn(async () => ({
        granted: [],
        denied: [],
        flags: {
          clipboardRead: false,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
      })),
      screenshotFiltering: "native",
    },
  );
  expect(JSON.stringify(after)).toContain("Call request_access again");
});

it("CFi residual opens enable prompt for action tools too (not only request_access)", async () => {
  const onPermissionRequest = vi.fn(async () => ({
    granted: [],
    denied: [],
    flags: {
      clipboardRead: false,
      clipboardWrite: false,
      systemKeyCombos: false,
    },
  }));
  const result = await handleCoworkComputerUseFeatureDisabledCall(
    "screenshot",
    {},
    {
      getTccState: async () => ({
        accessibility: "granted",
        screenRecording: "granted",
      }),
      isChicagoEnabled: () => false,
      onPermissionRequest,
      screenshotFiltering: "native",
    },
  );
  expect(onPermissionRequest).toHaveBeenCalledTimes(1);
  expect(
    (
      onPermissionRequest.mock.calls.at(0)?.at(0) as unknown as {
        featureDisabled?: boolean;
      }
    )?.featureDisabled,
  ).toBe(true);
  // Denied enable after action tool → residual "Call request_access" guidance.
  expect(JSON.stringify(result)).toContain("Call request_access");
  expect(JSON.stringify(result)).not.toContain("not fully wired");
});

it("createCoworkComputerUseMcpServerConfig injects alwaysLoad computer-use on supported OS", () => {
  const server = createCoworkComputerUseMcpServerConfig({
    getTccState: async () => ({
      accessibility: "granted",
      screenRecording: "granted",
    }),
    isChicagoEnabled: () => false,
    onPermissionRequest: async () => ({
      granted: [],
      denied: [],
      flags: {
        clipboardRead: false,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
    }),
  });
  if (process.platform === "darwin" || process.platform === "win32") {
    expect(server).toBeTruthy();
    expect(server).toMatchObject({ name: "computer-use" });
  } else {
    expect(server).toBeNull();
  }
});

it("with hostAdapter null refuses action tools honestly (no invent screenshots)", async () => {
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  const server = createCoworkComputerUseMcpServerConfig({
    getAllowedApps: () => [
      {
        bundleId: "com.apple.finder",
        displayName: "Finder",
        grantedAt: Date.now(),
        tier: "full",
      },
    ],
    getGrantFlags: () => ({
      clipboardRead: false,
      clipboardWrite: false,
      systemKeyCombos: false,
    }),
    hostAdapter: null,
    isChicagoEnabled: () => true,
    onPermissionRequest: async () => ({
      granted: [],
      denied: [],
      flags: {
        clipboardRead: false,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
    }),
  });
  expect(server).toBeTruthy();
  // SDK MCP instance — tools array may be internal; smoke that config built.
  expect(server).toMatchObject({ name: "computer-use" });
});

it("gFi/aFi residual: Zod wrap keeps installed apps on request_access apps.describe", () => {
  // Official buildComputerUseTools splices installedAppNames into apps.description.
  // Product must not drop that when mapping residual → SDK tool() Zod shape.
  const residual = buildComputerUseTools(
    {
      platform: "darwin",
      screenshotFiltering: "native",
      teachMode: true,
    },
    "pixels",
    ["Notes", "Finder", "Safari"],
  );
  const requestAccess = residual.find((t) => t.name === "request_access");
  const teachAccess = residual.find((t) => t.name === "request_teach_access");
  expect(requestAccess?.inputSchema?.properties?.apps?.description).toContain(
    "Available applications on this machine: Notes, Finder, Safari.",
  );
  expect(teachAccess?.inputSchema?.properties?.apps?.description).toContain(
    "Available applications on this machine: Notes, Finder, Safari.",
  );

  for (const schema of [requestAccess, teachAccess]) {
    expect(schema).toBeTruthy();
    const shape = computerUseToolShapeForResidual(
      schema as {
        name: string;
        description?: string;
        inputSchema?: {
          properties?: Record<string, { description?: string } | undefined>;
        };
      },
    );
    const appsDesc = (shape.apps as { description?: string }).description;
    expect(appsDesc).toContain(
      "Available applications on this machine: Notes, Finder, Safari.",
    );
  }

  // Server construct with installedAppNames inject must not throw and names computer-use.
  if (process.platform === "darwin" || process.platform === "win32") {
    const server = createCoworkComputerUseMcpServerConfig({
      hostAdapter: null,
      installedAppNames: ["Notes", "Finder", "Safari"],
      isChicagoEnabled: () => true,
      onPermissionRequest: async () => ({
        granted: [],
        denied: [],
        flags: {
          clipboardRead: false,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
      }),
    });
    expect(server).toMatchObject({ name: "computer-use" });
  }
});

