"use strict";
function noop() {}
function identity(value) { return value; }
function constant(value) { return () => value; }
function isObject(value) { return value !== null && typeof value === "object"; }
function isRecord(value) { return isObject(value) && !Array.isArray(value); }
function assert(condition, message = "assertion failed") { if (!condition) throw new Error(message); }
function sleep(ms, signal) { return new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason ?? new Error("aborted")); const timer = setTimeout(resolve, Math.max(0, Number(ms) || 0)); signal?.addEventListener?.("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true }); }); }
function defer() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function once(fn) { let called = false; let result; return function onceWrapper(...args) { if (!called) { called = true; result = fn.apply(this, args); } return result; }; }
function memoize(fn, keyFn = (...args) => JSON.stringify(args)) { const cache = new Map(); return function memoized(...args) { const key = keyFn(...args); if (!cache.has(key)) cache.set(key, fn.apply(this, args)); return cache.get(key); }; }
function compact(values) { return Array.from(values || []).filter(Boolean); }
function uniq(values) { return Array.from(new Set(values || [])); }
function clamp(value, min, max) { const n = Number(value); return Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)); }
function pick(value, keys) { const output = {}; if (!isRecord(value)) return output; for (const key of keys || []) if (Object.prototype.hasOwnProperty.call(value, key)) output[key] = value[key]; return output; }
function omit(value, keys) { const blocked = new Set(keys || []); const output = {}; if (!isRecord(value)) return output; for (const [key, entry] of Object.entries(value)) if (!blocked.has(key)) output[key] = entry; return output; }
function toError(value) { if (value instanceof Error) return value; const error = new Error(typeof value === "string" ? value : JSON.stringify(value)); error.cause = value; return error; }
function tryJsonParse(value, fallback = undefined) { try { return JSON.parse(String(value)); } catch { return fallback; } }
function stableStringify(value) { return JSON.stringify(value, (_key, entry) => isRecord(entry) ? Object.keys(entry).sort().reduce((acc, key) => { acc[key] = entry[key]; return acc; }, {}) : entry); }
function ensureArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
module.exports = { noop, identity, constant, isObject, isRecord, assert, sleep, defer, createDeferred: defer, once, memoize, compact, uniq, clamp, pick, omit, toError, tryJsonParse, stableStringify, ensureArray };
module.exports.default = module.exports;
