# Desktop 官方依赖基线对齐报告

生成命令：`npm run compare:official-deps`

## 结论

- 官方 package：`@ant/desktop@1.6608.2`，依赖入口 103 个。
- 当前 package：`claude-deepseek-desktop@1.6608.2-deepseek.0`，依赖入口 103 个。
- 官方有 / 本地没有：0 个。
- 本地有 / 官方没有：0 个。
- 同名版本不一致：0 个。
- private `@ant/*`：15 个；本地已内建 15 个，仍缺失 0 个。

官方来源：`D:\BaiduNetdiskDownload\Claude code 汉化mac桌面版\Claude-Deepseek\Claude-Deepseek.app\Contents\Resources\app.asar`

## 已优先补齐的公开 npm 依赖

本仓库先补 desktop 壳子直接需要、且可从 npm 正常安装的官方公开依赖。未一次性补齐全部 UI/测试/内部构建依赖，避免把 renderer/web 依赖面扩散到 desktop-only 改造。

- runtime / IPC / MCP：`ws`, `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/mcpb`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`
- desktop shell：`electron-store`, `electron-window-state`, `fs-extra`, `jsonc-parser`, `semver`, `ssh2`, `p-queue`, `rxjs`, `winston`, `winston-transport`
- archive / media：`tar`, `yauzl`, `extract-zip`, `fflate`, `sharp`
- packaging / Forge：`@electron/asar`, `@electron-forge/maker-base`, `@electron-forge/maker-dmg`, `@electron-forge/maker-msix`, `@electron-forge/maker-squirrel`, `@electron-forge/plugin-base`, `@electron-forge/plugin-fuses`, `@electron-forge/plugin-vite`, `@electron-forge/shared-types`, `@electron/fuses`, `@electron/notarize`

## 官方有 / 本地没有

| package | section | official spec | packaged in app.asar | note |
| --- | --- | --- | --- | --- |

## 本地有 / 官方没有

无。

## 同名版本不一致

无。

## private @ant/* 本地内建清单

| package | section | local spec | 内建方式 | 官方安装包证据 |
| --- | --- | --- | --- | --- |
| @ant/chrome-native-host | devDependencies | file:vendor/ant/chrome-native-host | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/claude-for-chrome-mcp | dependencies | file:vendor/ant/claude-for-chrome-mcp | source-built | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/claude-native | dependencies | file:vendor/ant/claude-native | runtime proxy（app.asar 4 项） | node_modules/@ant/claude-native<br>node_modules/@ant/claude-native/claude-native-binding.node<br>node_modules/@ant/claude-native/index.js<br>node_modules/@ant/claude-native/package.json |
| @ant/claude-screen-app | devDependencies | file:vendor/ant/claude-screen-app | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/claude-ssh | devDependencies | file:vendor/ant/claude-ssh | bundle-derived | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/claude-swift | dependencies | file:vendor/ant/claude-swift | runtime proxy（app.asar 8 项） | node_modules/@ant/claude-swift<br>node_modules/@ant/claude-swift/build<br>node_modules/@ant/claude-swift/build/Release<br>node_modules/@ant/claude-swift/build/Release/computer_use.node<br>node_modules/@ant/claude-swift/build/Release/swift_addon.node |
| @ant/claude-swift-ant | devDependencies | file:vendor/ant/claude-swift-ant | runtime-proxy | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/computer-use-mcp | dependencies | file:vendor/ant/computer-use-mcp | source-built | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/cowork-win32-service | devDependencies | file:vendor/ant/cowork-win32-service | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/disclaimer | devDependencies | file:vendor/ant/disclaimer | bundle-derived | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/dxt-registry | devDependencies | file:vendor/ant/dxt-registry | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/imagine-server | dependencies | file:vendor/ant/imagine-server | bundle-derived | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/ipc-codegen | devDependencies | file:vendor/ant/ipc-codegen | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/rfb-client | devDependencies | file:vendor/ant/rfb-client | protocol-adapter | 官方安装包无独立模块，使用本地 builtin adapter |
| @ant/utils | devDependencies | file:vendor/ant/utils | compat-shim | 官方安装包无独立模块，使用本地 builtin adapter |

说明：官方私有包不走 registry 安装；当前用 `file:vendor/ant/*` 内建进本包。官方安装包里有实体模块的包走 runtime proxy；能在本机官方源码树找到的包走 source-built；能从官方 bundle 或本机官方源码恢复行为的包走 bundle-derived / protocol-adapter；官方私有源码不可得且安装包无独立模块的 dev 包走 source-owned compat-shim。

## private @ant/* 官方证据清单

| package | section | official spec | app.asar 独立模块 | 官方入口证据 |
| --- | --- | --- | --- | --- |
| @ant/chrome-native-host | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/claude-for-chrome-mcp | dependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/claude-native | dependencies | * | 是（4 项） | node_modules/@ant/claude-native<br>node_modules/@ant/claude-native/claude-native-binding.node<br>node_modules/@ant/claude-native/index.js<br>node_modules/@ant/claude-native/package.json |
| @ant/claude-screen-app | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/claude-ssh | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/claude-swift | dependencies | * | 是（8 项） | node_modules/@ant/claude-swift<br>node_modules/@ant/claude-swift/build<br>node_modules/@ant/claude-swift/build/Release<br>node_modules/@ant/claude-swift/build/Release/computer_use.node<br>node_modules/@ant/claude-swift/build/Release/swift_addon.node |
| @ant/claude-swift-ant | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/computer-use-mcp | dependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/cowork-win32-service | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/disclaimer | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/dxt-registry | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/imagine-server | dependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/ipc-codegen | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/rfb-client | devDependencies | * | 否 | 未在 app.asar 独立打包 |
| @ant/utils | devDependencies | * | 否 | 未在 app.asar 独立打包 |

处理原则：不能从 npm registry 直接安装 `@ant/*`。本仓库用本地 builtin 包占住依赖入口，并把包内部补成 runtime proxy / source-built / protocol-adapter / bundle-derived / compat-shim；当前不再保留会在调用时直接抛错的空包。

### @ant/* 替代策略

| package | 官方用途 | 官方调用入口 / 证据 | 当前本地替代方案 | 状态 |
| --- | --- | --- | --- | --- |
| @ant/claude-native | 原生 Node binding，承载官方 desktop native 能力。 | `app.asar/node_modules/@ant/claude-native`，含 `index.js` 与 `claude-native-binding.node`。 | `vendor/ant/claude-native` 内建包代理 `resources/original-runtime-node_modules`。 | builtin runtime proxy |
| @ant/claude-swift | Swift / computer-use 原生 addon。 | `app.asar/node_modules/@ant/claude-swift`，含 `js/index.js`、`swift_addon.node`、`computer_use.node`。 | `vendor/ant/claude-swift` 内建包代理 `resources/original-runtime-node_modules`。 | builtin runtime proxy |
| @ant/claude-for-chrome-mcp | 官方 Chrome MCP 能力包。 | package.json dependency；app.asar 已被 Vite 打包；本机 `claude-code/packages/@ant/claude-for-chrome-mcp` 有源码。 | 已拷贝源码到 `vendor/ant/claude-for-chrome-mcp` 并编译 `dist`。 | source-built |
| @ant/computer-use-mcp | 官方 computer-use MCP 能力包。 | package.json dependency；相关 native 证据在 `@ant/claude-swift/build/Release/computer_use.node`；本机 `claude-code/packages/@ant/computer-use-mcp` 有源码。 | 已拷贝源码到 `vendor/ant/computer-use-mcp` 并编译 `dist`。 | source-built |
| @ant/imagine-server | 官方 imagine 相关本地服务。 | package.json dependency；官方前端 bundle 暴露 `ui://imagine/show-widget.html` 与 `show_widget` 工具语义。 | `vendor/ant/imagine-server` 实现 widget/MCP lifecycle adapter。 | bundle-derived |
| @ant/claude-ssh | 官方 SSH 能力。 | package.json devDependency；official `.vite/build/index.js` 内嵌 `claude-ssh-releases` manifest。 | `vendor/ant/claude-ssh` 暴露官方 bundle 中恢复的版本、checksum、平台和下载 URL。 | bundle-derived |
| @ant/rfb-client | 官方 RFB / remote framebuffer 客户端能力。 | package.json devDependency；renderer bundle 有 framebuffer/RFB 相关调用语义。 | `vendor/ant/rfb-client` 实现 RFB event client、frame/update/key/pointer surface。 | protocol-adapter |
| @ant/utils | 官方共享工具库。 | package.json devDependency；未在 app.asar 中发现独立模块。 | `vendor/ant/utils` 提供 source-owned 通用工具兼容面。 | compat-shim |
| @ant/cowork-win32-service | 官方 Windows cowork service。 | package.json devDependency；未在 app.asar 中发现独立模块。 | `vendor/ant/cowork-win32-service` 实现 Windows `sc.exe` service controller adapter。 | protocol-adapter |
| @ant/chrome-native-host | 官方 Chrome native host 开发/打包支持。 | package.json devDependency；本机 `claude-code/src/utils/claudeInChrome/chromeNativeHost.ts` 有纯 TS 实现。 | `vendor/ant/chrome-native-host` 已实现 native-messaging frame、socket/pipe bridge、reader 与 host runtime。 | protocol-adapter |
| @ant/disclaimer | 官方 disclaimer 内部包。 | official `shellPathWorker.js` 与 main bundle 含 disclaimer binary wrapping 逻辑。 | `vendor/ant/disclaimer` 实现 bundle-derived launch/spawn wrapper。 | bundle-derived |
| @ant/dxt-registry | 官方 DXT registry 内部包。 | official preload/main settings surface 含 `/dxt/extensions` registry/list/version shape。 | `vendor/ant/dxt-registry` 实现 registry URL、memory registry、extension/version API adapter。 | protocol-adapter |
| @ant/ipc-codegen | 官方 IPC codegen 内部包。 | official preload 使用 `$eipc_message$` channel 编码与 namespace/interface/method 结构。 | `vendor/ant/ipc-codegen` 实现 channel build/parse、invoke/sync proxy 和 event emit adapter。 | protocol-adapter |
| @ant/claude-screen-app | 官方 screen app 内部包。 | package.json devDependency；desktop main/renderer 需要 screen/session/capture 语义。 | `vendor/ant/claude-screen-app` 实现 screen session lifecycle adapter。 | protocol-adapter |
| @ant/claude-swift-ant | 官方 Swift Ant 开发包。 | official runtime native implementation 已通过 `@ant/claude-swift` 复制。 | `vendor/ant/claude-swift-ant` 代理本地 `@ant/claude-swift` runtime surface。 | runtime proxy |

## 官方非标准依赖处理

| package | section | official spec | current spec | 处理方式 |
| --- | --- | --- | --- | --- |
| @anthropic-ai/claude-agent-sdk-future | devDependencies | npm:@anthropic-ai/claude-agent-sdk@0.2.128-dev.20260502.t172331.shaaff9e14 | file:vendor/anthropic-ai/claude-agent-sdk-future | sdk alias to installed @anthropic-ai/claude-agent-sdk |
| @anthropic-ai/electron-devtools-mcp | devDependencies | workspace:* | file:vendor/anthropic-ai/electron-devtools-mcp | local builtin |
| @electron-forge/maker-pkg | devDependencies | patch:@electron-forge/maker-pkg@npm:^7.8.3#~/.yarn/patches/@electron-forge-maker-pkg-npm-7.8.3-929b4f1f3b.patch | 7.8.3 | real npm package for patch target |
| @electron-forge/publisher-gcs | devDependencies | patch:@electron-forge/publisher-gcs@npm:7.8.3#~/.yarn/patches/@electron-forge-publisher-gcs-npm-7.8.3-37ee0bd5f3.patch | 7.8.3 | real npm package for patch target |
| @formatjs/intl | devDependencies | patch:@formatjs/intl@npm:2.10.7#~/.yarn/patches/@formatjs-intl-npm-2.10.7-cddd00b4c3.patch | 2.10.7 | real npm package for patch target |

说明：官方 yarn patch / workspace / npm alias 不能在 npm lockfile 中原样复用。可安装的 patch target 已改为真实 npm 包；registry/workspace 不可用的包使用本地 builtin。

## 仍待评估的公开 npm 依赖

以下官方公开依赖本轮没有强行加入 desktop-only package，避免把完整 renderer / monorepo / lint-test 面全部拉入壳子。后续若源码开始直接 import，再按官方版本补齐。

无。
