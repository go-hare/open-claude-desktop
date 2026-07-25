import { expect, it, vi } from "vitest";
import {
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
    (onPermissionRequest.mock.calls.at(0)?.at(0) as { featureDisabled?: boolean })
      ?.featureDisabled,
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

