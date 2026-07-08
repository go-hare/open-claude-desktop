"use strict";
const { EventEmitter } = require("node:events");
function isSupported() { return true; }
function normalizeCaptureOptions(options = {}) { return { displayId: options.displayId || options.screenId || null, width: Number(options.width || 0), height: Number(options.height || 0), fps: Number(options.fps || 1) || 1 }; }
async function listDisplays(electronScreen) { const source = electronScreen?.getAllDisplays ? electronScreen : undefined; return source ? source.getAllDisplays().map((display) => ({ id: String(display.id), bounds: display.bounds, scaleFactor: display.scaleFactor })) : []; }
class ScreenSession extends EventEmitter { constructor(options = {}) { super(); this.options = normalizeCaptureOptions(options); this.running = false; } async start() { this.running = true; this.emit("start", this.options); return this; } async stop() { this.running = false; this.emit("stop"); } isRunning() { return this.running; } async captureFrame(frame = null) { const payload = { frame, capturedAt: new Date().toISOString(), options: this.options }; this.emit("frame", payload); return payload; } updateOptions(options = {}) { this.options = { ...this.options, ...normalizeCaptureOptions(options) }; this.emit("options", this.options); return this.options; } }
function createScreenSession(options) { return new ScreenSession(options); }
function createScreenApp(options = {}) { const sessions = new Set(); return { options, createSession(sessionOptions = {}) { const session = createScreenSession({ ...options, ...sessionOptions }); sessions.add(session); session.once("stop", () => sessions.delete(session)); return session; }, listSessions: () => Array.from(sessions), async stopAll() { await Promise.all(Array.from(sessions, (session) => session.stop())); } }; }
module.exports = { isSupported, normalizeCaptureOptions, listDisplays, ScreenSession, createScreenSession, createScreenApp };
module.exports.default = module.exports;
