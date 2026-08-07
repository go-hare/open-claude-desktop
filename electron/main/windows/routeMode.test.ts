import { afterEach, expect, it } from "vitest";
import {
  anthropicOriginUrl,
  resolveAnthropicMainWindowUrl,
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

it("void 1p (no jsA chooser) keeps product LoginDesktop — not force claude.ai", () => {
  delete process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW;
  delete process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW;
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    persistedDeploymentMode: undefined,
    productMainViewUrl: "http://127.0.0.1:5176/login",
  });
  expect(url).toBe("http://localhost:5176/login");
});

it("void chooser stamps /login onto bare product origin (Sign out clear cold start)", () => {
  delete process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW;
  delete process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW;
  // Dev CLAUDE_DESKTOP_MAIN_VIEW_URL is origin-only — must not paint /task/new first.
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    persistedDeploymentMode: undefined,
    productMainViewUrl: "http://127.0.0.1:5176",
  });
  expect(url).toBe("http://localhost:5176/login");
});

it("void chooser stamps /login onto app:// base (packaged clear residual)", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    persistedDeploymentMode: undefined,
    baseUrl: "app://localhost",
  });
  expect(url).toBe("app://localhost/login");
});

it("3p stamps /task/new onto bare product origin", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "3p",
    persistedDeploymentMode: "3p",
    productMainViewUrl: "http://127.0.0.1:5176",
    hasRendererConfig: true,
    sidebarMode: "task",
  });
  expect(url).toBe("http://localhost:5176/task/new");
});

it("persisted 1p after NQt loads official mN + /task/new?coldLaunch=1 (loadAll residual)", () => {
  delete process.env.CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW;
  delete process.env.CLAUDE_FORCE_PRODUCT_MAIN_VIEW;
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    persistedDeploymentMode: "1p",
    productMainViewUrl: "http://127.0.0.1:5176/login",
  });
  // Bare https://claude.ai/ is marketing landing — desktop uses product path + coldLaunch.
  expect(url).toBe("https://claude.ai/task/new?coldLaunch=1");
  expect(resolveAnthropicMainWindowUrl("epitaxy")).toBe("https://claude.ai/epitaxy");
});

it("3p main window uses product main view URL (localhost normalize)", () => {
  // Residual: only jsA("3p") / persistedDeploymentMode enters shell path.
  // Bag-only N1e 3p without chooser still loads LoginDesktop (account null).
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "3p",
    persistedDeploymentMode: "3p",
    productMainViewUrl: "http://127.0.0.1:5176/task/new",
    hasRendererConfig: true,
    sidebarMode: "task",
  });
  expect(url).toBe("http://localhost:5176/task/new");
});

it("3p without product override uses app:// task residual", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "3p",
    persistedDeploymentMode: "3p",
    baseUrl: "app://localhost",
    hasRendererConfig: true,
    sidebarMode: "task",
  });
  expect(url).toContain("app://localhost");
  expect(url).toContain("/task/new");
});

it("force Anthropic main view opts into official mN + task path", () => {
  const url = resolveMainWindowLoadUrl({
    deploymentMode: "1p",
    productMainViewUrl: "http://127.0.0.1:5176/",
    forceAnthropicMainView: true,
  });
  expect(url).toBe("https://claude.ai/task/new?coldLaunch=1");
});

it("resolveInitialMainViewUrl still maps task residual", () => {
  expect(resolveInitialMainViewUrl("app://localhost", "task", true)).toBe(
    "app://localhost/task/new",
  );
});
