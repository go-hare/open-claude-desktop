export function readJsonArg<T>(prefix: string, fallback: T): T {
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  try {
    return JSON.parse(raw.slice(prefix.length)) as T;
  } catch {
    return fallback;
  }
}
