import type { IpcNamespace } from "../ipc/channel";

export type InvokeMethodName = string;
export type EventMethodName = string;

export type InterfaceBridgeSpec = {
  invoke?: InvokeMethodName[];
  events?: EventMethodName[];
};

export type NamespaceBridgeSpec = Record<string, InterfaceBridgeSpec>;
export type BridgeSpec = Partial<Record<IpcNamespace, NamespaceBridgeSpec>> & Record<string, NamespaceBridgeSpec>;

export type RemoveListener = () => void;
export type BridgeCallback = (...args: unknown[]) => void;

export type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  send?: (channel: string, ...args: unknown[]) => void;
  sendSync?: (channel: string, ...args: unknown[]) => unknown;
};
