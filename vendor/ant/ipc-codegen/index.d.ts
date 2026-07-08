export const EIPC_MESSAGE_PREFIX: "$eipc_message$";
export const EIPC_NAMESPACE_UUID: string;
export interface ParsedIpcChannel { uuid: string; namespace: string; iface: string; method: string }
export function buildIpcChannel(namespace: string, iface: string, method: string): string;
export function parseIpcChannel(channel: string): ParsedIpcChannel | null;
export function normalizeMethodList(methods: string[] | Record<string, unknown>): string[];
export function defineInterface(namespace: string, iface: string, methods?: string[] | Record<string, unknown>): Readonly<{ namespace: string; iface: string; methods: Readonly<Record<string, string>> }>;
export function defineNamespace(namespace: string, interfaces?: Record<string, string[] | Record<string, unknown>>): Readonly<{ namespace: string; interfaces: Readonly<Record<string, ReturnType<typeof defineInterface>>> }>;
export function createInvokeProxy<T = Record<string, (...args: any[]) => Promise<any>>>(ipcRenderer: any, namespace: string, iface: string, methods?: string[] | Record<string, unknown>): T;
export function createSyncProxy<T = Record<string, (...args: any[]) => any>>(ipcRenderer: any, namespace: string, iface: string, methods?: string[] | Record<string, unknown>): T;
export function createBridgeSpec<T extends Record<string, unknown>>(spec: T): Readonly<T>;
export function emitBridgeEvent(webContents: any, namespace: string, iface: string, method: string, ...args: any[]): string;
declare const ipcCodegen: typeof import("./index");
export default ipcCodegen;
