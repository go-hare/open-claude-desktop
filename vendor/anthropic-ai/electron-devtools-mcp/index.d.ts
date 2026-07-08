export const DEVTOOLS_TOOLS: ReadonlyArray<Record<string, unknown>>;
export function createElectronDevtoolsMcpServer(options?: { electron?: any }): { name: string; getTools(): unknown[]; handleToolCall(name: string, args?: Record<string, unknown>): Promise<unknown>; start(): Promise<unknown>; stop(): Promise<void> };
export const createServer: typeof createElectronDevtoolsMcpServer;
declare const devtools: typeof import("./index");
export default devtools;
