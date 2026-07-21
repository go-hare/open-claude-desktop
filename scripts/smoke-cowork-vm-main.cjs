/**
 * Electron main process for dual-exec VM live smoke.
 * Loaded only by scripts/smoke-cowork-vm.mjs (temporary app dir).
 *
 * Flow: load @ant/claude-swift → snapshot/startVM → wait guest → optional oneshot bash → stopVM
 * Never invents host child_process bash as "guest".
 */
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const userData =
  process.env.CLAUDE_VM_USERDATA
  || path.join(
    os.homedir(),
    "Library/Application Support/Claude-Deepseek",
  );
const bundlePath = path.join(userData, "vm_bundles", "claudevm.bundle");
const resourcesRoot =
  process.env.CLAUDE_DESKTOP_RESOURCES_ROOT
  || path.join(projectRoot, "resources");
const smolBin = path.join(resourcesRoot, `smol-bin.${arch}.img`);
const skipBash = process.env.CLAUDE_VM_SMOKE_SKIP_BASH === "1";
const skipClaude = process.env.CLAUDE_VM_SMOKE_SKIP_CLAUDE === "1";
const keepRunning = process.env.CLAUDE_VM_SMOKE_KEEP_RUNNING === "1";
const readyProbeMs = Number(process.env.CLAUDE_VM_SMOKE_READY_MS ?? 90_000);

function result(payload) {
  // Single-line JSON for parent parser.
  console.log("[smoke-cowork-vm-result]", JSON.stringify(payload));
}

function asBool(raw, key) {
  if (typeof raw === "boolean") return raw;
  if (raw && typeof raw === "object" && key in raw) return Boolean(raw[key]);
  return Boolean(raw);
}

function loadSwiftVm() {
  const candidates = [
    path.join(
      projectRoot,
      "resources/original-runtime-node_modules/node_modules/@ant/claude-swift/package.json",
    ),
    path.join(projectRoot, "node_modules/@ant/claude-swift/package.json"),
  ];
  for (const pkgJson of candidates) {
    if (!fs.existsSync(pkgJson)) continue;
    try {
      const req = createRequire(pkgJson);
      const mod = req(path.dirname(pkgJson));
      const container = mod?.default ?? mod;
      const vm = container?.vm ?? container;
      if (vm && typeof vm.startVM === "function") {
        return { vm, from: pkgJson };
      }
    } catch (error) {
      console.error("[smoke-cowork-vm-main] load failed", pkgJson, error);
    }
  }
  return { vm: null, from: null };
}

async function waitGuest(vm, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { running: false, connected: false };
  while (Date.now() < deadline) {
    try {
      const runningRaw = await vm.isRunning();
      const connectedRaw = await vm.isGuestConnected();
      last = {
        running: asBool(runningRaw, "running"),
        connected: asBool(connectedRaw, "connected"),
      };
      if (last.connected) return last;
    } catch (error) {
      last = {
        running: false,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ...last, timeout: true };
}

/**
 * Oneshot guest spawn with shared event callbacks.
 * Never uses host child_process — only vm.spawn.
 */
async function oneshotGuest(vm, {
  processName,
  command,
  args,
  cwd = "/",
  timeoutMs = 30_000,
  marker = null,
}) {
  const id = `smoke-${processName}-${randomUUID()}`;
  let output = "";
  let exitCode = null;
  let exitSignal = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (typeof vm.kill === "function") {
        void vm.kill(id, "SIGTERM").catch(() => undefined);
      }
      reject(new Error(`${processName} oneshot timeout ${timeoutMs}ms`));
    }, timeoutMs);

    const onStdout = (pid, data) => {
      if (pid !== id) return;
      output += String(data ?? "");
    };
    const onStderr = (pid, data) => {
      if (pid !== id) return;
      output += String(data ?? "");
    };
    const onExit = (pid, code, signal) => {
      if (pid !== id) return;
      exitCode = code ?? 0;
      exitSignal = signal ?? null;
      clearTimeout(timer);
      resolve();
    };
    const onError = (pid, message) => {
      if (pid !== id) return;
      clearTimeout(timer);
      reject(new Error(String(message ?? "error")));
    };

    if (typeof vm.setEventCallbacks === "function") {
      vm.setEventCallbacks(
        onStdout,
        onStderr,
        onExit,
        onError,
        () => {},
        () => {},
        () => {},
      );
    }

    const mounts = {};
    Promise.resolve()
      .then(async () => {
        try {
          await vm.spawn(
            id,
            processName,
            command,
            args,
            cwd,
            undefined,
            mounts,
            false,
            undefined,
            true,
            undefined,
          );
        } catch (firstError) {
          await vm.spawn({
            id,
            name: processName,
            command,
            args,
            cwd,
            additionalMounts: mounts,
            isResume: false,
            oneShot: true,
          });
        }
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  return {
    command,
    args,
    exitCode,
    exitSignal,
    output: output.slice(0, 4000),
    hasMarker: marker ? output.includes(marker) : exitCode === 0,
  };
}

async function oneshotBash(vm) {
  return oneshotGuest(vm, {
    processName: "smoke-oneshot",
    command: "bash",
    args: ["-c", "echo smoke-guest-ok; uname -a; pwd"],
    cwd: "/",
    marker: "smoke-guest-ok",
  });
}

/**
 * Official dual-exec guest binary probe: /usr/local/bin/claude exists + --version.
 * Spawns the guest binary directly (not host child_process). Skip with CLAUDE_VM_SMOKE_SKIP_CLAUDE=1.
 */
async function oneshotGuestClaude(vm) {
  // Probe via bash first for clear missing-binary diagnostics (still guest bash).
  const probe = await oneshotGuest(vm, {
    processName: "smoke-claude-probe",
    command: "bash",
    args: [
      "-c",
      "if [ -x /usr/local/bin/claude ]; then echo smoke-claude-present; /usr/local/bin/claude --version; else echo smoke-claude-missing; ls -la /usr/local/bin/claude 2>&1 || true; exit 2; fi",
    ],
    cwd: "/sessions",
    timeoutMs: 45_000,
    marker: "smoke-claude-present",
  });
  if (!probe.hasMarker) {
    return {
      ...probe,
      binaryPresent: false,
      directSpawn: null,
    };
  }

  // Direct guest spawn of dual-exec path binary (official pathToClaudeCodeExecutable).
  let directSpawn = null;
  try {
    directSpawn = await oneshotGuest(vm, {
      processName: "smoke-claude-direct",
      command: "/usr/local/bin/claude",
      args: ["--version"],
      cwd: "/sessions/smoke-claude-direct",
      timeoutMs: 45_000,
      marker: null,
    });
  } catch (error) {
    directSpawn = {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ...probe,
    binaryPresent: true,
    directSpawn,
    ok:
      probe.hasMarker
      && probe.exitCode === 0
      && Boolean(
        directSpawn
        && !directSpawn.error
        && (directSpawn.exitCode === 0 || (directSpawn.output || "").length > 0),
      ),
  };
}

async function run() {
  // Isolate Electron userData for notifications/caches; VM bundle stays on product path.
  const smokeUserData = path.join(projectRoot, ".smoke-cowork-vm-user-data");
  fs.mkdirSync(smokeUserData, { recursive: true });
  app.setPath("userData", smokeUserData);

  await app.whenReady();

  const preflight = {
    platform: process.platform,
    arch,
    userData,
    bundlePath,
    bundleReady: fs.existsSync(path.join(bundlePath, "rootfs.img")),
    smolBinExists: fs.existsSync(smolBin),
    smolBin,
  };
  console.log("[smoke-cowork-vm-main] preflight", JSON.stringify(preflight));

  if (process.platform !== "darwin") {
    result({ ok: false, stage: "platform", preflight, error: "darwin only" });
    app.exit(1);
    return;
  }
  if (!preflight.bundleReady) {
    result({
      ok: false,
      stage: "bundle",
      preflight,
      error: "rootfs.img missing — run link-claudevm-bundle-from-official.mjs",
    });
    app.exit(2);
    return;
  }

  const { vm, from } = loadSwiftVm();
  if (!vm) {
    result({
      ok: false,
      stage: "loadSwift",
      preflight,
      error: "Failed to load @ant/claude-swift vm API under Electron",
    });
    app.exit(3);
    return;
  }
  console.log("[smoke-cowork-vm-main] loaded swift from", from);

  let virtualization = null;
  if (typeof vm.isVirtualizationSupported === "function") {
    try {
      virtualization = await vm.isVirtualizationSupported();
      console.log("[smoke-cowork-vm-main] virtualization", virtualization);
      if (
        virtualization
        && virtualization !== "supported"
        && virtualization !== true
      ) {
        // entitlement_missing is expected under stock Electron; packaged Claude has
        // com.apple.security.virtualization. Fail honestly — do not invent host bash.
        result({
          ok: false,
          stage: "virtualization",
          support: virtualization,
          error: String(virtualization),
          hint:
            virtualization === "entitlement_missing"
              ? "Use packaged out/.../Claude-Deepseek.app (has virtualization entitlement), not stock Electron"
              : undefined,
        });
        app.exit(4);
        return;
      }
    } catch (error) {
      console.warn("[smoke-cowork-vm-main] isVirtualizationSupported failed", error);
    }
  }

  let startError = null;
  try {
    console.log("[smoke-cowork-vm-main] startVM", bundlePath);
    try {
      await vm.startVM(bundlePath, undefined, undefined, "gvisor", undefined);
    } catch (firstError) {
      try {
        await vm.startVM({ bundlePath });
      } catch {
        throw firstError;
      }
    }
  } catch (error) {
    startError = error instanceof Error ? error.message : String(error);
    result({
      ok: false,
      stage: "startVM",
      preflight,
      error: startError,
    });
    app.exit(5);
    return;
  }

  const guest = await waitGuest(vm, readyProbeMs);
  console.log("[smoke-cowork-vm-main] guest", JSON.stringify(guest));

  let bash = null;
  if (guest.connected && !skipBash) {
    try {
      bash = await oneshotBash(vm);
      console.log("[smoke-cowork-vm-main] bash", JSON.stringify({
        exitCode: bash.exitCode,
        hasMarker: bash.hasMarker,
        outputHead: bash.output.slice(0, 200),
      }));
    } catch (error) {
      bash = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let claude = null;
  if (guest.connected && !skipClaude && (skipBash || (bash && bash.hasMarker))) {
    try {
      claude = await oneshotGuestClaude(vm);
      console.log("[smoke-cowork-vm-main] claude", JSON.stringify({
        binaryPresent: claude.binaryPresent,
        ok: claude.ok,
        exitCode: claude.exitCode,
        outputHead: (claude.output || "").slice(0, 200),
        directExit: claude.directSpawn?.exitCode ?? null,
      }));
    } catch (error) {
      claude = {
        error: error instanceof Error ? error.message : String(error),
        binaryPresent: false,
        ok: false,
      };
    }
  }

  if (!keepRunning && typeof vm.stopVM === "function") {
    try {
      await vm.stopVM(false);
      console.log("[smoke-cowork-vm-main] stopVM ok");
    } catch (error) {
      console.warn("[smoke-cowork-vm-main] stopVM failed", error);
    }
  }

  const bashOk = skipBash || (bash && bash.hasMarker === true);
  const claudeOk = skipClaude || (claude && claude.ok === true);
  const ok =
    guest.connected === true
    && bashOk
    && claudeOk;

  let stage = "complete";
  if (!guest.connected) stage = "guest";
  else if (!bashOk) stage = "bash";
  else if (!claudeOk) stage = "claude";

  result({
    ok,
    stage: ok ? "complete" : stage,
    preflight,
    guest,
    bash,
    claude,
    skipBash,
    skipClaude,
  });
  app.exit(ok ? 0 : 6);
}

run().catch((error) => {
  result({
    ok: false,
    stage: "uncaught",
    error: error instanceof Error ? error.message : String(error),
  });
  app.exit(99);
});
