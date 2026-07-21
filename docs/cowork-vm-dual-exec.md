# Cowork dual-exec Linux VM (official alignment)

## Split (do not conflate)

| Surface | Provider | Role |
| --- | --- | --- |
| CLI / Agent SDK `sandbox` | `@anthropic-ai/claude-agent-sdk` `options.sandbox` | Command isolation for spawned CLI |
| **Cowork Linux VM** | Desktop `@ant/claude-swift` `CoworkVMManager` + `smol-bin` + `rootfs.img` | Isolated Linux guest for workspace bash / dual-exec |

Official Cowork “isolated Linux workspace” is the **VM**, not CLI sandbox alone.

## Official anchors (app.asar)

- Bundle dir: `userData/vm_bundles/claudevm.bundle` (`RHA` + `aGi`)
- Manifest `Hn.sha` + `files.darwin.arm64[0]=rootfs.img`
- Resources: `smol-bin.<arch>.img` (USB mass storage for guest)
- Load: `import("@ant/claude-swift").default.vm` (`Mn` / `tPe`)
- Client: `startVM(bundlePath, memoryGB, cpuCount, "gvisor", apiProbeURL)`, `stopVM`, `isRunning`, `isGuestConnected`, `mountPath`, `spawn`, …
- Product `ClaudeVM` IPC: `download` / `startVM` / `getRunningStatus` / `setForceDisableHostLoop` / …
- Policy: `vi().requireCoworkFullVmSandbox`, store `forceDisableHostLoop`, GrowthBook `1143815894`

## Product state (this repo)

### P0 landed (partial)

- `electron/main/services/coworkVm/coworkClaudeVm.ts` — load swift, path helpers, start/stop/snapshot **without** host-loop fake `running`
- `featureHandlers` `ClaudeVM.*` delegates to service; events keep official channel names
- Unit tests with injected swift mock
- `resources/smol-bin.arm64.img` + `smol-bin.x64.img` copied from official app Resources
- helper: `scripts/link-claudevm-bundle-from-official.mjs` **hardlinks** Claude-3p bundle into product userData

### P1 landed (partial)

- `coworkVmGuestBash.ts` — official `O1i` / `Y1i` / `xeA` / `YeA` oneshot guest bash via `spawn` + `setEventCallbacks` (no host `child_process`)
- `coworkVmBashMounts.ts` — official `j1i` / `Cq` / `_o` / `Zn` host-loop mount map + `vmCwd`
- `coworkSessionRuntimeController` host-loop workspace MCP injects `getVmStatus` + `runBash` + `computeBashMounts`

### P2 landed (partial)

- `coworkVmProcess.ts` — official `SZe` / `tGi` / `iGi` guest Claude spawn; ensure guest connected before spawn
- `coworkVmDualExecMounts.ts` — Ym folders, `.claude` rwd, memory/uploads + **readOnlyPluginPaths → ro plugin mounts**
- `coworkAgentQueryFactory` — dual-exec guest binary/cwd/spawn; option-build does **not** call startVM
- Runtime `dualExecSpawn` + best-effort early startVM

### Policy sources (partial)

| Source | Wired? |
| --- | --- |
| `featureState.vmForceDisableHostLoop` via `ClaudeVM.setForceDisableHostLoop` | yes → hostLoop false |
| Settings preference `requireCoworkFullVmSandbox === true` | yes residual |
| Env `CLAUDE_REQUIRE_COWORK_FULL_VM_SANDBOX=1` | yes residual |
| Env `CLAUDE_HOST_LOOP_FEATURE` / `CLAUDE_FORCE_HOST_LOOP` (+ dev override) | yes (env wins over kni) |
| GrowthBook flag `1143815894` via `ft`/kni seed | yes (3p `hardcodedMainGrowthBookFeatures` → on) |
| Enterprise `vi().requireCoworkFullVmSandbox` (MDM plist / configLibrary / remote tier) | yes residual (`coworkEnterpriseConfig.ts`; win32 registry / full QB schema residual) |
| 1p `/api/desktop/features` + `userData/fcache` | yes residual (`coworkGrowthBookFetch.ts`; `CLAUDE_DEPLOYMENT_MODE=1p` on bootstrap) |

### Bundle on this machine (2026-07-21+)

Linked into product userData (hardlink from Claude-3p):

`~/Library/Application Support/Claude-Deepseek/vm_bundles/claudevm.bundle` (`rootfs.img` ~10GB)

Re-run: `node scripts/link-claudevm-bundle-from-official.mjs`

CDN residual (product now implements official shape):

- Base: `https://downloads.claude.ai/vms/linux/<arch>/<Hn.sha>`
- File: `rootfs.img.zst` + sha256 checksum from `Hn.files` + `.rootfs.img.origin` = `Hn.sha`
- IPC `ClaudeVM.download` → `ensureCoworkVmRootfs` (no-op when ready; fails honestly offline)

### Live Electron smoke (native layer) — PASS 2026-07-21 / guest Claude 2026-07-21

```bash
npm run prepare:smoke-electron   # once (or auto from smoke:cowork-vm)
npm run smoke:cowork-vm          # node scripts/smoke-cowork-vm.mjs
```

Observed on this machine:

| Stage | Result |
| --- | --- |
| readiness (FS) | ok (bundle + smol + swift package) |
| virtualization | `supported` under ad-hoc signed smoke Electron (`com.apple.security.virtualization`) |
| startVM | Linux VM started (gvisor, 4 CPU / 6GB, EFI/GRUB) |
| guest | `running` + `connected` (vsock / coworkd) |
| oneshot bash | `exitCode:0`, marker `smoke-guest-ok`, uname `Linux claude 6.8.0-106-generic aarch64`, cwd `/sessions/smoke-oneshot` |
| guest Claude | `/usr/local/bin/claude --version` → `2.1.128 (Claude Code)`; direct guest spawn exit 0 |
| stopVM | ok |

Operational notes (honest, not invented):

1. Stock `node_modules/electron` reports `entitlement_missing` — must use smoke-signed Electron or product binary with virtualization entitlement.
2. Swift loads `smol-bin.<arch>.img` from `process.resourcesPath` (Electron.app/Contents/Resources), not only project `resources/`.
3. Hardlinked `rootfs.img` shared with Claude-3p can fail `VZErrorDomain Code=2` if another `com.apple.Virtualization.VirtualMachine` still holds the file — kill orphan VMs or use a private copy.
4. Packaged product app has the entitlement but loads product asar, so it cannot host the temp smoke main.
5. CDN `downloads.claude.ai` may time out offline — link residual remains valid.

### Plugin paths (UXe fill)

- Consume: `pluginMountsFromReadOnlyPaths(session.readOnlyPluginPaths)` in dual-exec mounts + factory
- Fill: `collectCoworkReadOnlyPluginPaths` from `userData/.../cowork_plugins/installed_plugins.json` + remote rpm dirs when account/org identity present; does not invent missing installs

### Honest residual

1. Enterprise **win32** `SOFTWARE\Policies\…` registry + native `Jn()` plist bridge; full enterprise QB key schema (product reads require key only)
2. GrowthBook periodic refresh timer (`R0A` 1h / 5min) + account-change `I9t` re-fetch (one-shot bootstrap residual)
3. Full remote plugin sync / skillsPluginPath SA/sA / space-path kK like full UXe (path collect is install-manifest residual)
4. Live CDN download end-to-end when network allows (unit-tested inject path; this machine timed out on CDN HEAD)

## Do not invent

- Host-side fake bash claiming to be sandboxed
- Docker/Firejail substitute labeled as official VM
- `ClaudeVM.startVM` returning `mode: "host-loop"` success without guest
