export interface LaunchOptions { cmd: string; args?: string[] }
export interface SpawnAsyncOptions { ignoreExitCode?: boolean; maxBuffer?: number; stdin?: string | Buffer; [key: string]: unknown }
export interface SpawnAsyncResult { stdout: string; stderr: string; code: number | null }
export const DEFAULT_MAX_BUFFER: number;
export function getDisclaimerBinaryPath(resourcesPath?: string): string;
export function getUntrustedLaunchOptions(options: LaunchOptions): { cmd: string; args: string[] };
export function wrapCommand(cmd: string, args?: string[]): { cmd: string; args: string[] };
export function isDisclaimerAvailable(fs?: { existsSync(path: string): boolean }): boolean;
export function spawnAsync(cmd: string, args?: string[], options?: SpawnAsyncOptions): Promise<SpawnAsyncResult>;
export function spawnAsyncDirect(cmd: string, args?: string[], options?: SpawnAsyncOptions): Promise<SpawnAsyncResult>;
declare const disclaimer: typeof import("./index");
export default disclaimer;
