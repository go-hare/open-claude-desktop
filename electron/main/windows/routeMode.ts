import type { InitialRouteMode, SidebarMode } from "./types";

export function normalizeSidebarMode(sidebarMode?: SidebarMode): InitialRouteMode {
  if (sidebarMode === "code") return "epitaxy";
  if (sidebarMode === "task") return "task";
  if (sidebarMode === "epitaxy") return "epitaxy";
  return "chat";
}

export function resolveInitialMainViewUrl(baseUrl: string, mode: InitialRouteMode, hasRendererConfig = false): string {
  const url = new URL(baseUrl);

  // Mirrors original logic:
  // - with a discovered 3P renderer config, chat/task both enter /task/new; code enters /epitaxy
  // - without it, sidebarMode decides; chat keeps the base URL
  const targetMode = hasRendererConfig ? (mode === "epitaxy" ? "epitaxy" : "task") : mode;

  if (targetMode === "task") {
    url.pathname = "/task/new";
  } else if (targetMode === "epitaxy") {
    url.pathname = "/epitaxy";
  }

  return url.toString();
}
