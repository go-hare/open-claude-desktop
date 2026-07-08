import { EventEmitter } from "node:events";
export const RFB_STATE: Readonly<Record<string, string>>;
export function encodePointerEvent(x: number, y: number, buttonMask?: number): Record<string, unknown>;
export function encodeKeyEvent(key: string | number, down?: boolean): Record<string, unknown>;
export class RfbClient extends EventEmitter { constructor(options?: Record<string, unknown>); getState(): Record<string, unknown>; connect(options?: Record<string, unknown>): Promise<this>; close(): void; send(data: unknown): void; sendPointerEvent(x: number, y: number, buttonMask?: number): unknown; sendKeyEvent(key: string | number, down?: boolean): unknown; sendClipboardText(text: string): unknown; resize(width: number, height: number): unknown; updateFrame(frame: unknown): unknown; }
export function createRfbClient(options?: Record<string, unknown>): RfbClient;
declare const rfb: typeof import("./index");
export default rfb;
