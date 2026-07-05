import { contextBridge } from "electron";
import { buildIpcChannel } from "../../shared/ipc/channel";
import type { BridgeCallback, BridgeSpec, IpcRendererLike, NamespaceBridgeSpec, RemoveListener } from "../../shared/bridge/spec";

export type ExposedNamespace = Record<string, Record<string, unknown>>;

function createInvoke(namespace: string, iface: string, method: string, ipcRenderer: IpcRendererLike) {
  return (...args: unknown[]) => ipcRenderer.invoke(buildIpcChannel(namespace, iface, method), ...args);
}

function createEventSubscription(namespace: string, iface: string, method: string, ipcRenderer: IpcRendererLike) {
  return (callback: BridgeCallback): RemoveListener => {
    const channel = buildIpcChannel(namespace, iface, method);
    const listener = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

export function createNamespaceBridge(namespace: string, spec: NamespaceBridgeSpec, ipcRenderer: IpcRendererLike): ExposedNamespace {
  const exposed: ExposedNamespace = {};

  for (const [iface, ifaceSpec] of Object.entries(spec)) {
    exposed[iface] = {};
    for (const method of ifaceSpec.invoke ?? []) {
      exposed[iface][method] = createInvoke(namespace, iface, method, ipcRenderer);
    }
    for (const method of ifaceSpec.events ?? []) {
      exposed[iface][method] = createEventSubscription(namespace, iface, method, ipcRenderer);
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
