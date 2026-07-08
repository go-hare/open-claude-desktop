"use strict";
function loadClaudeSwift() { try { return require("@ant/claude-swift"); } catch (error) { return { __loadError: error }; } }
function isAvailable() { return !loadClaudeSwift().__loadError; }
function getNativeModule() { const runtime = loadClaudeSwift(); return runtime.__loadError ? null : runtime; }
function loadSwiftAddon() { const runtime = getNativeModule(); return runtime?.swiftAddon ?? runtime?.swift ?? runtime; }
function loadComputerUseAddon() { const runtime = getNativeModule(); return runtime?.computerUse ?? runtime?.computer_use ?? runtime; }
function createComputerUseClient(options = {}) { const native = getNativeModule(); return { options, native, available: Boolean(native), async start() { return { available: Boolean(native) }; }, async stop() {} }; }
const runtime = loadClaudeSwift();
module.exports = { ...(!runtime.__loadError && typeof runtime === "object" ? runtime : {}), __loadError: runtime.__loadError || null, isAvailable, getNativeModule, loadSwiftAddon, loadComputerUseAddon, createComputerUseClient };
module.exports.default = module.exports;
