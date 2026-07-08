export const IMAGINE_WIDGET_URI: string;
export const IMAGINE_TOOLS: ReadonlyArray<Record<string, unknown>>;
export function renderWidgetHtml(input?: { html?: string; title?: string }): string;
export function createImagineServer(options?: { host?: string; port?: number }): { events: any; readonly uri: string; getTools(): unknown[]; getLastWidget(): unknown; handleToolCall(name: string, args?: Record<string, unknown>): Promise<unknown>; start(): Promise<unknown>; stop(): Promise<void>; isRunning(): boolean; address(): unknown };
export const createMcpServer: typeof createImagineServer;
declare const imagine: typeof import("./index");
export default imagine;
