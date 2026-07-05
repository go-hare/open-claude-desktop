import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { buildIpcChannel, type IpcNamespace } from "../../../shared/ipc/channel";
import { recordIpcHandler } from "./handlerRegistry";

export type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>;
export type SyncIpcHandler = (event: IpcMainEvent, ...args: unknown[]) => unknown;
export type InterfaceHandlers = Record<string, IpcHandler>;
export type NamespaceHandlers = Record<string, InterfaceHandlers>;

export function registerDirectInvokeHandler(channel: string, handler: IpcHandler, owner = "direct"): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
  recordIpcHandler(channel, "invoke", "real", owner);
}

export function registerDirectSyncHandler(channel: string, handler: SyncIpcHandler, owner = "direct"): void {
  ipcMain.removeAllListeners(channel);
  ipcMain.on(channel, (event, ...args) => {
    try {
      event.returnValue = { result: handler(event, ...args) };
    } catch (error) {
      event.returnValue = { error: error instanceof Error ? error.message : String(error) };
    }
  });
  recordIpcHandler(channel, "sync", "real", owner);
}

export function registerInterfaceHandlers(namespace: IpcNamespace | string, iface: string, handlers: InterfaceHandlers, owner?: string): void {
  for (const [method, handler] of Object.entries(handlers)) {
    const channel = buildIpcChannel(namespace, iface, method);
    registerDirectInvokeHandler(channel, handler, owner ?? `${namespace}.${iface}`);
  }
}

export function registerInterfaceSyncHandlers(namespace: IpcNamespace | string, iface: string, handlers: Record<string, SyncIpcHandler>, owner?: string): void {
  for (const [method, handler] of Object.entries(handlers)) {
    const channel = buildIpcChannel(namespace, iface, method);
    registerDirectSyncHandler(channel, handler, owner ?? `${namespace}.${iface}`);
  }
}

export function registerNamespaceHandlers(namespace: IpcNamespace | string, handlers: NamespaceHandlers, owner?: string): void {
  for (const [iface, interfaceHandlers] of Object.entries(handlers)) {
    registerInterfaceHandlers(namespace, iface, interfaceHandlers, owner);
  }
}

export function dispatchBridgeEvent(target: WebContents, namespace: IpcNamespace | string, iface: string, method: string, ...args: unknown[]): void {
  if (target.isDestroyed()) return;
  target.send(buildIpcChannel(namespace, iface, method), ...args);
}

export function createDefaultHandler(defaultValue: unknown = null): IpcHandler {
  return async () => defaultValue;
}
