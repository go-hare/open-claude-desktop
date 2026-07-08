export interface DxtExtension { id: string; uuid: string; manifest: Record<string, unknown>; source: string; versions: unknown[] }
export function normalizeExtension(value?: Record<string, any>): DxtExtension;
export function normalizeVersion(value?: Record<string, any>): Record<string, unknown> & { version: string };
export function emptyMarketplaceList(): { extensions: DxtExtension[]; items: DxtExtension[]; nextPage: null };
export function createExtensionUrl(baseUrl: string, ...parts: string[]): string;
export function parseDxtReference(input: string): { publisher?: string; name: string; id: string; version?: string };
export function createMemoryRegistry(initial?: unknown[]): { list(): DxtExtension[]; search(query?: string): DxtExtension[]; get(id: string): DxtExtension | null; add(entry: unknown): DxtExtension; remove(id: string): boolean; versions(id: string): unknown[] };
export function fetchJson(url: string, options?: RequestInit): Promise<unknown>;
export function listExtensions(source?: string | ReturnType<typeof createMemoryRegistry> | unknown): Promise<unknown>;
export function getExtension(source: string | ReturnType<typeof createMemoryRegistry>, id: string): Promise<unknown>;
export function listExtensionVersions(source: string | ReturnType<typeof createMemoryRegistry>, id: string): Promise<unknown[]>;
export function getExtensionVersion(source: string | ReturnType<typeof createMemoryRegistry>, id: string, version: string): Promise<unknown | null>;
declare const registry: typeof import("./index");
export default registry;
