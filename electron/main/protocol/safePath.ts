import path from "node:path";

export function resolveInsideRoot(root: string, requestPathname: string): string | null {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, `.${decodeURIComponent(requestPathname)}`);

  if (candidate === resolvedRoot) return candidate;
  if (!candidate.startsWith(resolvedRoot + path.sep)) return null;
  return candidate;
}
