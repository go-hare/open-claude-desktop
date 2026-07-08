# Desktop private module source audit

Generated during dependency/function parity work for official `@ant/desktop@1.6608.2`.

## Search surfaces checked

- Official app bundle: `D:\BaiduNetdiskDownload\Claude code 汉化mac桌面版\Claude-Deepseek\Claude-Deepseek.app\Contents\Resources\app.asar`
- Mirrored official shell source: `D:\work\py\claude\claude-ion-react-workbench\electron-shell-source\app-asar`
- Local Claude Code source tree: `D:\work\py\claude\claude-code`
- Workspace roots under `D:\work\py\claude`
- Public npm registry via `npm view <package> version --json`

## Implemented / function-aligned modules

| package | status | evidence | local implementation |
| --- | --- | --- | --- |
| `@ant/claude-native` | runtime proxy | Present in official `app.asar/node_modules/@ant/claude-native` with `.node` binding. | `vendor/ant/claude-native` proxies copied files under `resources/original-runtime-node_modules`. |
| `@ant/claude-swift` | runtime proxy | Present in official `app.asar/node_modules/@ant/claude-swift` with `swift_addon.node` and `computer_use.node`. | `vendor/ant/claude-swift` proxies copied files under `resources/original-runtime-node_modules`. |
| `@ant/claude-for-chrome-mcp` | source-built | Found source at `D:\work\py\claude\claude-code\packages\@ant\claude-for-chrome-mcp`. | Source copied to `vendor/ant/claude-for-chrome-mcp` and compiled to `dist`. |
| `@ant/computer-use-mcp` | source-built | Found source at `D:\work\py\claude\claude-code\packages\@ant\computer-use-mcp`. | Source copied to `vendor/ant/computer-use-mcp` and compiled to `dist`. |
| `@ant/chrome-native-host` | protocol-adapter | Found official pure TS implementation at `D:\work\py\claude\claude-code\src\utils\claudeInChrome\chromeNativeHost.ts`. | `vendor/ant/chrome-native-host` implements native-message frames, pipe/socket bridge, reader, and runtime entrypoint. |
| `@ant/claude-ssh` | bundle-derived | Official `.vite/build/index.js` embeds the `claude-ssh-releases` manifest, pinned version, checksums, platform list, and download URL pattern. | `vendor/ant/claude-ssh` exposes manifest helpers plus download/verify/prepare helpers. |
| `@anthropic-ai/claude-agent-sdk-future` | sdk-alias | Official declares an npm alias to an unpublished dev SDK; installed public `@anthropic-ai/claude-agent-sdk@0.2.128` is available. | `vendor/anthropic-ai/claude-agent-sdk-future` re-exports the installed SDK runtime and subpaths. |
| `@electron-forge/maker-pkg` | real npm | Official yarn patch target is `@electron-forge/maker-pkg@7.8.3`. | Uses real npm package `7.8.3`. |
| `@electron-forge/publisher-gcs` | real npm | Official yarn patch target is `@electron-forge/publisher-gcs@7.8.3`. | Uses real npm package `7.8.3`. |
| `@formatjs/intl` | real npm | Official yarn patch target is `@formatjs/intl@2.10.7`. | Uses real npm package `2.10.7`. |

## Previously missing private modules now backed by local adapters

The following names still cannot be installed from the public registry (`E404`) and are not present as independent modules in the official app bundle. They are no longer throwing placeholders: each package now has a source-owned runtime surface so imports and common calls work locally.

| package | registry | official evidence | current local state |
| --- | --- | --- | --- |
| `@ant/claude-screen-app` | E404 | desktop screen/session/capture semantics in shell/renderer surfaces | `protocol-adapter`: screen session lifecycle, display listing and frame event API |
| `@ant/claude-swift-ant` | E404 | native Swift runtime already copied as `@ant/claude-swift` | `runtime-proxy`: bridges to local `@ant/claude-swift` runtime surface |
| `@ant/cowork-win32-service` | E404 | Windows cowork service package entry | `protocol-adapter`: Windows `sc.exe` service controller surface |
| `@ant/disclaimer` | E404 | official `shellPathWorker.js`/main bundle wraps untrusted launches via `Helpers/disclaimer` on macOS | `bundle-derived`: binary path, launch wrapping, async spawn helpers |
| `@ant/dxt-registry` | E404 | official settings/extension IPC uses `/dxt/extensions` registry/list/version shapes | `protocol-adapter`: registry URL helpers, memory registry, extension/version APIs |
| `@ant/imagine-server` | E404 | official frontend bundle exposes `ui://imagine/show-widget.html` and `show_widget` tool | `bundle-derived`: Imagine widget/MCP lifecycle adapter |
| `@ant/ipc-codegen` | E404 | official preload uses `$eipc_message$` namespace/interface/method channel encoding | `protocol-adapter`: channel build/parse, invoke/sync proxy, event emit helpers |
| `@ant/rfb-client` | E404 | official renderer contains framebuffer/RFB semantics | `protocol-adapter`: RFB event client, key/pointer/clipboard/frame APIs |
| `@ant/utils` | E404 | dev-only shared utility package entry; no independent bundle module | `compat-shim`: common utility helpers used by source-owned code |
| `@anthropic-ai/conway-client` | E404 | official package pins `0.2.0-dev.20260422...`; renderer has Conway lab route strings | `compat-shim`: Conway HTTP client and memory client |
| `@anthropic-ai/electron-devtools-mcp` | E404 | official workspace dependency; Electron devtools menu/trace surfaces exist in shell | `protocol-adapter`: Electron DevTools MCP tool adapter |

## Verification

Use:

```powershell
npm run verify:builtins
npm run compare:official-deps
npm run verify:runtime
npm run build:main
npm run build:preload
```

Current `verify:builtins` reports 18 implemented builtin packages, 0 placeholders, 0 import failures, and 0 smoke failures.
