/**
 * Ambient types for vendor `@ant/computer-use-mcp`.
 * Package `exports` point at dist JS without types condition; residual product
 * only needs the symbols used by computer-use host-loop MCP inject.
 */
declare module "@ant/computer-use-mcp" {
  export type CuGrantFlags = {
    clipboardRead: boolean;
    clipboardWrite: boolean;
    systemKeyCombos: boolean;
  };

  export type CuPermissionRequest = {
    apps: Array<{
      alreadyGranted: boolean;
      isSentinel: boolean;
      proposedTier: "read" | "click" | "full";
      requestedName: string;
      resolved?: {
        bundleId?: string;
        displayName?: string;
        iconDataUrl?: string;
      };
    }>;
    reason?: string;
    requestedFlags?: Partial<CuGrantFlags>;
    requestId?: string;
    screenshotFiltering?: "native" | "none" | "mask";
  };

  export type CuPermissionResponse = {
    denied: Array<{ bundleId: string; reason: string }>;
    flags: CuGrantFlags;
    granted: Array<{
      bundleId: string;
      displayName: string;
      grantedAt: number;
      tier: "read" | "click" | "full";
    }>;
  };

  export type ComputerUseToolSchema = {
    description?: string;
    name: string;
    inputSchema?: unknown;
  };

  export function buildComputerUseTools(
    caps: {
      platform: "darwin" | "win32";
      screenshotFiltering: "native" | "none" | "mask";
      teachMode?: boolean;
    },
    coordinateMode: "pixels" | "normalized",
    installedAppNames?: string[],
  ): ComputerUseToolSchema[];
}
