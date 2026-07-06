import { contextBridge } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";
import type { BridgeCallback, BridgeSpec, IpcRendererLike, NamespaceBridgeSpec, RemoveListener } from "../../shared/bridge/spec";

export type ExposedNamespace = Record<string, Record<string, unknown>>;

function createInvoke(namespace: string, iface: string, method: string, ipcRenderer: IpcRendererLike) {
  return (...args: unknown[]) => ipcRenderer.invoke(buildIpcChannel(namespace, iface, method), ...args);
}

function createSync(namespace: string, iface: string, method: string, ipcRenderer: IpcRendererLike) {
  return (...args: unknown[]) => {
    if (!ipcRenderer.sendSync) throw new Error(`Synchronous IPC is unavailable for ${namespace}.${iface}.${method}`);
    const response = ipcRenderer.sendSync(buildIpcChannel(namespace, iface, method), ...args) as { error?: string; result?: unknown };
    if (response?.error) throw new Error(response.error);
    return response?.result;
  };
}

function createEventSubscription(namespace: string, iface: string, method: string, ipcRenderer: IpcRendererLike) {
  return (callback: BridgeCallback): RemoveListener => {
    const channel = buildIpcChannel(namespace, iface, method);
    const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

function officialEventAlias(method: string): string {
  return `on${method.slice(0, 1).toUpperCase()}${method.slice(1)}`;
}

export function createNamespaceBridge(namespace: string, spec: NamespaceBridgeSpec, ipcRenderer: IpcRendererLike): ExposedNamespace {
  const exposed: ExposedNamespace = {};

  for (const [iface, ifaceSpec] of Object.entries(spec)) {
    exposed[iface] = {};
    for (const method of ifaceSpec.invoke ?? []) {
      exposed[iface][method] = createInvoke(namespace, iface, method, ipcRenderer);
    }
    for (const method of ifaceSpec.sync ?? []) {
      exposed[iface][method] = createSync(namespace, iface, method, ipcRenderer);
    }
    for (const method of ifaceSpec.events ?? []) {
      const subscribe = createEventSubscription(namespace, iface, method, ipcRenderer);
      exposed[iface][method] = subscribe;
      exposed[iface][officialEventAlias(method)] ??= subscribe;
    }
    for (const method of ifaceSpec.invoke ?? []) {
      const match = /^(.+)_\$store\$_getState$/.exec(method);
      if (!match) continue;
      const storePrefix = match[1];
      const updateMethod = `${storePrefix}_$store$_update`;
      const syncMethod = `${storePrefix}_$store$_getStateSync`;
      exposed[iface][`${storePrefix}Store`] = {
        getState: createInvoke(namespace, iface, method, ipcRenderer),
        getStateSync: createSync(namespace, iface, syncMethod, ipcRenderer),
        onStateChange: createEventSubscription(namespace, iface, updateMethod, ipcRenderer),
      };
    }
  }

  return exposed;
}

export function exposeBridgeSpec(spec: BridgeSpec, ipcRenderer: IpcRendererLike): void {
  for (const [namespace, namespaceSpec] of Object.entries(spec)) {
    contextBridge.exposeInMainWorld(namespace, createNamespaceBridge(namespace, namespaceSpec, ipcRenderer));
  }
}

export function exposeValue(name: string, value: unknown): void {
  contextBridge.exposeInMainWorld(name, value);
}
