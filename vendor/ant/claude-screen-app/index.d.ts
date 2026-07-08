import { EventEmitter } from "node:events";
export function isSupported(): boolean;
export function normalizeCaptureOptions(options?: Record<string, unknown>): { displayId: string | null; width: number; height: number; fps: number };
export function listDisplays(electronScreen?: { getAllDisplays(): unknown[] }): Promise<unknown[]>;
export class ScreenSession extends EventEmitter { constructor(options?: Record<string, unknown>); start(): Promise<this>; stop(): Promise<void>; isRunning(): boolean; captureFrame(frame?: unknown): Promise<unknown>; updateOptions(options?: Record<string, unknown>): unknown; }
export function createScreenSession(options?: Record<string, unknown>): ScreenSession;
export function createScreenApp(options?: Record<string, unknown>): { options: Record<string, unknown>; createSession(options?: Record<string, unknown>): ScreenSession; listSessions(): ScreenSession[]; stopAll(): Promise<void> };
declare const screenApp: typeof import("./index");
export default screenApp;
