import type { BrowserWindow, WebContentsView } from "electron";
import type { ElectronShellPaths } from "../paths/electronShellPaths";
import type { SecondaryWindowManager } from "./secondaryWindows";

export type SidebarMode = "chat" | "code" | "task" | "epitaxy";
export type InitialRouteMode = "task" | "epitaxy" | "chat";

export type DesktopTelemetryConfig = {
  deploymentMode: string;
  appVersion: string;
  cookielessOrigin: boolean;
};

export type DesktopWindowInitialState = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
};

export type DesktopWindowOptions = {
  paths: ElectronShellPaths;
  baseUrl: string;
  initialMainViewUrl?: string;
  windowState?: DesktopWindowInitialState;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  showOnCreate?: boolean;
  titleBarOverlay?: boolean | Electron.TitleBarOverlay;
  trafficLightPosition?: { x: number; y: number };
  backgroundColor?: string;
  desktopFeatures?: Record<string, unknown>;
  desktopEnterpriseConfig?: Record<string, unknown>;
  desktopTelemetryConfig: DesktopTelemetryConfig;
  sidebarMode?: SidebarMode;
  hasRendererConfig?: boolean;
  shouldQuitOnClose?: () => boolean;
  onMainWindowReady?: (mainWindow: BrowserWindow) => void;
  onMainViewDomReady?: (mainView: WebContentsView) => void;
  onMainViewFocus?: (mainView: WebContentsView) => void;
};

export type DesktopWindowParts = {
  mainWindow: BrowserWindow;
  mainView: WebContentsView;
  findInPageView: WebContentsView;
  secondaryWindows: SecondaryWindowManager;
  loadAll: () => Promise<void>;
  layout: () => void;
};
