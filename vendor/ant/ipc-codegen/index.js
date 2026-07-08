"use strict";
const EIPC_MESSAGE_PREFIX = "$eipc_message$";
const EIPC_NAMESPACE_UUID = "ea5fa1fd-aa4e-4f73-a689-0f14f3e8be79";
const CHANNEL_RE = /^\$eipc_message\$_([^_]+)_\$_(.+?)_\$_(.+?)_\$_(.+)$/;
function buildIpcChannel(namespace, iface, method) { if (!namespace || !iface || !method) throw new Error("namespace, iface and method are required"); return `${EIPC_MESSAGE_PREFIX}_${EIPC_NAMESPACE_UUID}_$_${namespace}_$_${iface}_$_${method}`; }
function parseIpcChannel(channel) { const match = String(channel || "").match(CHANNEL_RE); return match ? { uuid: match[1], namespace: match[2], iface: match[3], method: match[4] } : null; }
function normalizeMethodList(methods) { return Array.isArray(methods) ? methods.map(String) : methods && typeof methods === "object" ? Object.keys(methods) : []; }
function defineInterface(namespace, iface, methods = []) { const channels = {}; for (const method of normalizeMethodList(methods)) channels[method] = buildIpcChannel(namespace, iface, method); return Object.freeze({ namespace, iface, methods: Object.freeze(channels) }); }
function defineNamespace(namespace, interfaces = {}) { const output = {}; for (const [iface, methods] of Object.entries(interfaces)) output[iface] = defineInterface(namespace, iface, methods); return Object.freeze({ namespace, interfaces: Object.freeze(output) }); }
function createInvokeProxy(ipcRenderer, namespace, iface, methods = []) { const proxy = {}; for (const method of normalizeMethodList(methods)) proxy[method] = (...args) => ipcRenderer.invoke(buildIpcChannel(namespace, iface, method), ...args); return proxy; }
function createSyncProxy(ipcRenderer, namespace, iface, methods = []) { const proxy = {}; for (const method of normalizeMethodList(methods)) proxy[method] = (...args) => ipcRenderer.sendSync(buildIpcChannel(namespace, iface, method), ...args); return proxy; }
function createBridgeSpec(spec) { return Object.freeze({ ...(spec || {}) }); }
function emitBridgeEvent(webContents, namespace, iface, method, ...args) { const channel = buildIpcChannel(namespace, iface, method); webContents.send(channel, ...args); return channel; }
module.exports = { EIPC_MESSAGE_PREFIX, EIPC_NAMESPACE_UUID, buildIpcChannel, parseIpcChannel, normalizeMethodList, defineInterface, defineNamespace, createInvokeProxy, createSyncProxy, createBridgeSpec, emitBridgeEvent };
module.exports.default = module.exports;
