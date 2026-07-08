export function isAvailable(): boolean;
export function getNativeModule(): unknown | null;
export function loadSwiftAddon(): unknown | null;
export function loadComputerUseAddon(): unknown | null;
export function createComputerUseClient(options?: Record<string, unknown>): { options: Record<string, unknown>; native: unknown | null; available: boolean; start(): Promise<unknown>; stop(): Promise<void> };
export const __loadError: Error | null;
declare const swiftAnt: typeof import("./index") & Record<string, unknown>;
export default swiftAnt;
