export type HandlerKind = "fallback" | "real";
export type HandlerMode = "invoke" | "sync" | "send";

export type HandlerRegistration = {
  channel: string;
  kind: HandlerKind;
  mode: HandlerMode;
  owner: string;
};

function parseEipcChannel(channel: string): { namespace: string; iface: string; method: string } | null {
  const parts = channel.split("_$_");
  if (parts.length < 4) return null;
  return { namespace: parts[1] ?? "", iface: parts[2] ?? "", method: parts.slice(3).join("_$_") };
}

const registrations = new Map<string, HandlerRegistration>();

function keyFor(channel: string, mode: HandlerMode): string {
  return `${mode}\0${channel}`;
}

export function recordIpcHandler(channel: string, mode: HandlerMode, kind: HandlerKind, owner: string): void {
  registrations.set(keyFor(channel, mode), { channel, mode, kind, owner });
}

export function getIpcHandlerRegistrySummary() {
  const all = Array.from(registrations.values());
  const fallbackActive = all.filter((entry) => entry.kind === "fallback");
  const realActive = all.filter((entry) => entry.kind === "real");
  const byOwner: Record<string, number> = {};
  const fallbackByInterface: Record<string, number> = {};
  for (const entry of all) byOwner[entry.owner] = (byOwner[entry.owner] ?? 0) + 1;
  for (const entry of fallbackActive) {
    const parsed = parseEipcChannel(entry.channel);
    const key = parsed ? `${parsed.namespace}.${parsed.iface}` : entry.channel;
    fallbackByInterface[key] = (fallbackByInterface[key] ?? 0) + 1;
  }
  return {
    total: all.length,
    real: realActive.length,
    fallback: fallbackActive.length,
    byOwner,
    fallbackByInterface: Object.fromEntries(Object.entries(fallbackByInterface).sort((a, b) => b[1] - a[1])),
  };
}
