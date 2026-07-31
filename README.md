# Claudex Desktop Shell

这是按原 Claude Desktop `app.asar` 结构重建的 Electron 桌面壳项目（产品名 **Claudex**）。

当前口径已升级为：**壳功能面先与原包对齐，再逐项把 compiled JS 转正为 TypeScript 源码**。

## 当前默认运行形态

```txt
source main process
├─ electron/main/**                         # 已转正的主进程骨架
├─ app://localhost protocol                 # 本地 ion-dist 静态/3P API fallback
├─ custom schemes                           # cowork-artifact / cowork-file / claude-simulator / sentry-ipc
├─ original compiled preload bundles        # mainWindow / mainView / findInPage
├─ original secondary shell entries         # about / quick / buddy / coworkArtifact / workers / MCP runtime
├─ original runtime native/node modules     # node-pty / ws / @ant/claude-native / @ant/claude-swift
└─ original renderer window resources       # main / find-in-page / about / quick / buddy
```

默认 `npm run build` 会先构建当前 TypeScript 主进程，然后从 `../electron-shell-source/app-asar` 覆盖复制原包的 compiled preload / renderer / secondary shell 资源。这样运行层的 preload invoke 暴露面与原包一致；源码层继续逐步转正。

## 来源证据

- 原包资源镜像：`../electron-shell-source/app-asar/`
- 资源清单：`../docs/electron-shell-resource-inventory.json`
- 功能面对齐审计：`../docs/electron-shell-functional-gap.json`
- 架构文档：`../docs/electron-shell-architecture.md`

## 打包 vs 测试（两条加载路线，禁止混用）

| 场景 | 命令 | 主视图 | Web |
|------|------|--------|-----|
| **打包** | `npm run package` → `npm run package:open` | `app://localhost` | dual-root：`product-web` + residual `ion-dist` |
| **测试 / 开发** | `npm run dev` | `http://localhost:5176` | open-claude-web Vite |

| 平台 | 产物 | 可执行 |
|------|------|--------|
| macOS | `out/Claudex-darwin-<arch>/Claudex.app` | `Contents/MacOS/Claude` |
| Windows | `out/Claudex-win32-<arch>/` | `Claudex.exe` |

完整规范见 [`docs/package-and-test.md`](docs/package-and-test.md)（含 Windows 流水线）。

```bash
# 打包（host-native：在对应 OS 上执行）
# 产品 main + dual-root product-web/ion-dist；mac 另叠 residual MacOS/Claude
npm run package
npm run package:open                 # mac open .app / win 启动 Claudex.exe
npm run package:open -- --isolated   # 独立 userData，避免与 dev 单实例锁冲突
npm run package:open -- --kill-dev   # 先结束本仓库 dev Electron

# 开发 / 测试（终端 1：web，终端 2：壳）
cd ../open-claude-web && npm run dev   # :5176
cd open-claude-desktop && npm run dev  # CLAUDE_DESKTOP_MAIN_VIEW_URL=http://localhost:5176

# Smoke（隔离 userData）
npm run smoke              # 开发壳 + http 测试路由
npm run smoke:packaged     # 打包二进制，不注入 MAIN_VIEW_URL（mac Claude / win Claudex.exe）

# 其它
npm run build              # 主进程 + 原包壳资源 + runtime
npm run audit:shell
npm run verify:config
npm run verify:runtime
npm run sync:residual      # 可选：官方 residual → resources/original-claude.app + ion-dist
```

## 当前验证结果

已执行并通过：

```txt
npx tsc --noEmit
npm run verify:config
npm run verify:runtime
npm run build
npm run audit:shell
npm run package
npm run smoke
npm run smoke:packaged
```

关键审计结果：

```txt
mirror_resource_complete=true
current_resource_complete=true
current_preload_invoke_matches_original=true
missing_current_invoke_channels=[]
extra_current_invoke_channels=[]
original preload invoke=544
original preload sendSync=15
original renderer event channels=75
packaged .vite/build + .vite/renderer entry diff vs original=0
runtime real handlers=622
runtime fallback handlers=0
current runtime native modules complete=true
packaged runtime native modules complete=true
```

打包产物（host-native）：

```txt
# macOS
out/Claudex-darwin-<arch>/Claudex.app
  Contents/MacOS/Claude
  Contents/Resources/product-web/  # product SPA
  Contents/Resources/ion-dist/     # residual setup SPA
  Contents/Resources/app.asar      # product main (chunks fingerprint)

# Windows（在 Windows 主机 npm run package）
out/Claudex-win32-<arch>/
  Claudex.exe
  resources/product-web/           # product SPA
  resources/ion-dist/              # residual setup SPA
  resources/claude-code-bin/claude.exe
```

packaged smoke 输出：

```txt
[claudex-smoke] {"ok":true,"mainWindowVisible":true,"mainViewUrl":"app://localhost/task/new","findInPageVisible":false}
[claudex-smoke-runner] ok packaged=true signal=SIGKILL
```

说明：原 compiled preload 启动后会保留 Electron helper/renderer；smoke runner 在捕获 ok marker 后只清理本次启动的进程树，并以 0 退出。

## 仍需继续深化

当前已经做到“运行层壳暴露面 / 资源入口 / active IPC fallback / 原包 runtime native modules”对齐。后续继续深化的重点不再是 generic fallback，而是把仍为本地 shim 的外部服务语义接到可用后端：

- 远端 MCP / 插件市场 / Slack / 云端 teleport / Claude VM bundle 等需要真实服务端、凭据或设备的能力；
- about / quick / buddy 二级窗口已接入窗口管理和菜单入口，仍可继续按原包细节精修；
- shell-path-worker / transcript-search-worker / directMcpHost / nodeHost 已随原包资源进入产物，后续可继续源码化；
- custom schemes 已接入口，后续可继续补业务语义；
- macOS Info.plist / entitlements / signing / notarization 深度对齐。
