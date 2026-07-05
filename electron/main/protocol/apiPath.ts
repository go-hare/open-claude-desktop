import { API_PREFIXES, STATIC_CODE_EXTENSIONS } from "./constants";

export function normalizeApiPath(pathname: string): string {
  return pathname.startsWith("/edge-api/") ? `/api/${pathname.slice("/edge-api/".length)}` : pathname;
}

/** Original `FkA(path)` equivalent. */
export function isApiLikePath(pathname: string): boolean {
  return !STATIC_CODE_EXTENSIONS.test(pathname) && API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
