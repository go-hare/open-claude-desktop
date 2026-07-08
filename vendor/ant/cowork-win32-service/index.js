"use strict";
const childProcess = require("node:child_process");
const DEFAULT_SERVICE_NAME = "ClaudeCoworkService";
function isSupported(platform = process.platform) { return platform === "win32"; }
function runSc(args, options = {}) { if (!isSupported()) return Promise.resolve({ ok: false, unsupported: true, stdout: "", stderr: "", code: 0 }); return new Promise((resolve) => { const proc = childProcess.spawn("sc.exe", args, { windowsHide: true, ...options }); const stdout = []; const stderr = []; proc.stdout?.on("data", (data) => stdout.push(data)); proc.stderr?.on("data", (data) => stderr.push(data)); proc.on("error", (error) => resolve({ ok: false, error, stdout: "", stderr: error.message, code: 1 })); proc.on("close", (code) => resolve({ ok: code === 0, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), code })); }); }
function parseServiceStatus(output = "") { const state = output.match(/STATE\s*:\s*\d+\s+(\w+)/i)?.[1]?.toLowerCase() || "unknown"; return { state, running: state === "running", raw: output }; }
async function queryServiceStatus(name = DEFAULT_SERVICE_NAME) { const result = await runSc(["query", name]); return { ...parseServiceStatus(result.stdout), command: result }; }
async function startService(name = DEFAULT_SERVICE_NAME) { return runSc(["start", name]); }
async function stopService(name = DEFAULT_SERVICE_NAME) { return runSc(["stop", name]); }
async function installService(options = {}) { const name = options.name || DEFAULT_SERVICE_NAME; if (!options.binPath) throw new Error("binPath is required to install the service"); return runSc(["create", name, "binPath=", options.binPath, "DisplayName=", options.displayName || name, "start=", options.start || "demand"]); }
async function uninstallService(name = DEFAULT_SERVICE_NAME) { return runSc(["delete", name]); }
async function restartService(name = DEFAULT_SERVICE_NAME) { await stopService(name); return startService(name); }
function createServiceController(options = {}) { const name = options.name || DEFAULT_SERVICE_NAME; return { name, isSupported, query: () => queryServiceStatus(name), start: () => startService(name), stop: () => stopService(name), restart: () => restartService(name), install: (next = {}) => installService({ ...options, ...next, name }), uninstall: () => uninstallService(name) }; }
module.exports = { DEFAULT_SERVICE_NAME, isSupported, runSc, parseServiceStatus, queryServiceStatus, startService, stopService, restartService, installService, uninstallService, createServiceController };
module.exports.default = module.exports;
