export const EIPC_MESSAGE_PREFIX = "$eipc_message$";
export const EIPC_NAMESPACE_UUID = "ea5fa1fd-aa4e-4f73-a689-0f14f3e8be79";

export type IpcNamespace =
  | "claude.web"
  | "claude.settings"
  | "claude.internal.ui"
  | "claude.internal.findInPage"
  | "claude.hybrid"
  | "claude.skills"
  | "claude.simulator"
  | "claude.officeAddin"
  | "claude.buddy";

export function buildIpcChannel(namespace: IpcNamespace | string, iface: string, method: string): string {
  return `${EIPC_MESSAGE_PREFIX}_${EIPC_NAMESPACE_UUID}_$_${namespace}_$_${iface}_$_${method}`;
}
