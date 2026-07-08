export class ConwayClient { constructor(options?: Record<string, unknown>); baseUrl: string; apiKey: unknown; request(path: string, options?: RequestInit): Promise<unknown>; listProjects(): Promise<unknown>; getProject(id: string): Promise<unknown>; createSession(input?: Record<string, unknown>): Promise<unknown>; sendMessage(sessionId: string, message: unknown): Promise<unknown>; closeSession(sessionId: string): Promise<unknown>; }
export function createClient(options?: Record<string, unknown>): ConwayClient;
export function createMemoryClient(): Record<string, unknown>;
export default ConwayClient;
