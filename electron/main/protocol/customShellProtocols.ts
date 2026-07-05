import { net, protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SHELL_CUSTOM_PROTOCOLS = {
  coworkArtifact: "cowork-artifact",
  coworkFile: "cowork-file",
  claudeSimulator: "claude-simulator",
  sentryIpc: "sentry-ipc",
} as const;

const EMPTY_JSON_HEADERS = { "Content-Type": "application/json" } as const;

function emptyJson(status = 200): Response {
  return new Response("{}", { status, headers: EMPTY_JSON_HEADERS });
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

async function maybeFetchLocalFile(filePath: string): Promise<Response | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return net.fetch(pathToFileURL(filePath).href);
  } catch {
    return null;
  }
}

function localPathFromCoworkFileUrl(url: URL): string | null {
  // The original shell uses cowork-file as a privileged local preview scheme.
  // Support conservative file-style forms while refusing ambiguous host-only URLs.
  if (url.searchParams.has("path")) return url.searchParams.get("path");
  if (url.hostname === "localhost" || url.hostname === "") return decodeURIComponent(url.pathname);
  if (url.hostname.length === 1 && /^[a-z]$/i.test(url.hostname)) return `${url.hostname}:${decodeURIComponent(url.pathname)}`;
  return null;
}

async function handleCoworkFile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const localPath = localPathFromCoworkFileUrl(url);
  if (!localPath) return notFound();
  const normalized = path.resolve(localPath);
  return (await maybeFetchLocalFile(normalized)) ?? notFound();
}

export function registerShellCustomProtocolSchemes(appScheme: Electron.CustomScheme): void {
  protocol.registerSchemesAsPrivileged([
    appScheme,
    {
      scheme: SHELL_CUSTOM_PROTOCOLS.coworkArtifact,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
    {
      scheme: SHELL_CUSTOM_PROTOCOLS.coworkFile,
      privileges: { standard: true, secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: SHELL_CUSTOM_PROTOCOLS.claudeSimulator,
      privileges: { standard: true, secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: SHELL_CUSTOM_PROTOCOLS.sentryIpc,
      privileges: { secure: true, bypassCSP: true, corsEnabled: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export function installShellCustomProtocolHandlers(): void {
  protocol.handle(SHELL_CUSTOM_PROTOCOLS.coworkFile, handleCoworkFile);
  protocol.handle(SHELL_CUSTOM_PROTOCOLS.coworkArtifact, async () => notFound());
  protocol.handle(SHELL_CUSTOM_PROTOCOLS.claudeSimulator, async () => notFound());
  protocol.handle(SHELL_CUSTOM_PROTOCOLS.sentryIpc, async () => emptyJson(200));
}
