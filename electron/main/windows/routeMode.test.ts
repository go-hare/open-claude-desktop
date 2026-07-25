import { afterEach, expect, it } from "vitest";
import {
  anthropicOriginUrl,
  resolveInitialMainViewUrl,
  resolveMainWindowLoadUrl,
} from "./routeMode";

const prevAi = process.env.CLAUDE_AI_URL;
const prevForce = process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW;

afterEach(() => {
  if (prevAi === undefined) delete process.env.CLAUDE_AI_URL;
  else process.env.CLAUDE_AI_URL = prevAi;
  if (prevForce === undefined) delete process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW;
  else process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW = prevForce;
});

it("mN residual defaults to https://claude.ai", () => {
  delete process.env.CLAUDE_AI_URL;
  expect(anthropicOriginUrl()).toBe("https://claude.ai");
});

it("mN residual honors CLAUDE_AI_URL host", () => {
  process.env.CLAUDE_AI_URL = "https://preview.claude.ai/chat";
  expect(anthropicOriginUrl()).toBe("https://preview.claude.ai");
});

it("product 1p keeps product main view (LoginDesktop residual, not force claude.ai)", () => {
  delete process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW;
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    productMainViewUrl: "http://127.0.0.1:5176/login",
  });
  expect(url).toBe("http://localhost:5176/login");
});

it("3p main window uses product main view URL (localhost normalize)", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "3p",
    productMainViewUrl: "http://127.0.0.1:5176/task/new",
  });
  expect(url).toBe("http://localhost:5176/task/new");
});

it("3p without product override uses app:// task residual", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "3p",
    baseUrl: "app://localhost",
    hasRendererConfig: true,
    sidebarMode: "task",
  });
  expect(url).toContain("app://localhost");
  expect(url).toContain("/task/new");
});

it("force Anthropic main view opts into official mN host", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    productMainViewUrl: "http://127.0.0.1:5176/",
    forceAnthropicMainView: true,
  });
  expect(url).toBe("https://claude.ai/");
});

it("resolveInitialMainViewUrl still maps task residual", () => {
  expect(resolveInitialMainViewUrl("app://localhost", "task", true)).toBe(
    "app://localhost/task/new",
  );
});
