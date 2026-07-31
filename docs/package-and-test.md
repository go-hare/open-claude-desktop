# Claudex 打包与测试规范

## 两条加载路线（禁止混用）

| 场景 | 命令 | 主视图 URL | Web 来源 |
|------|------|------------|----------|
| **打包** | `npm run package` → `npm run package:open` | `app://localhost` | 打包树内 `ion-dist`（open-claude-web 构建产物） |
| **测试 / 开发** | `npm run dev` | `http://localhost:5176` | open-claude-web Vite（`CLAUDE_DESKTOP_MAIN_VIEW_URL`） |

- 打包**不得**默认打开 `https://claude.ai`（官方 1p mN residual 仅 debug：`CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1`）。
- 测试**不要**用打包的 `app://` 热更；改 web 用 Vite。
- Residual 官方 SPA（`data-build-id=spa-dev`）只用于 `resources/ion-dist` 审计对照，**不得**作为产品主 UI 交付。
- **Host-native**：在 mac 打 mac 包，在 Windows 打 win 包（native modules / forge 与主机一致）。不要指望在 mac 上直接产出可用的 win32 可运行包。

## 平台产物路径

| 平台 | 产物 | 可执行文件 | 产品 web（app:// 根） |
|------|------|------------|----------------------|
| **macOS** | `out/Claudex-darwin-<arch>/Claudex.app`（如 arm64） | `Contents/MacOS/Claude`（align 后 residual 名） | `Contents/Resources/ion-dist` |
| **Windows** | `out/Claudex-win32-<arch>/`（如 `x64` / `arm64`） | `Claudex.exe` | `resources/ion-dist` |

官方 shell 写死 `Hot()+"ion-dist"` 作为 `app://` 静态根；产品 web 必须注入**打包后**的 `ion-dist`，不能只留在 `resources/product-web/`。

## 打包流水线（`npm run package`）

实现：`scripts/package-product.mjs`  
对齐分发：`scripts/align-packaged-bundle.mjs` → mac / win 各自 align 脚本。

1. `npm run build`  
   - 产品 main / preload 构建  
   - `copy:original-shell` 覆盖官方 `.vite`（供 `audit:original` 字节对齐）  
   - residual runtime / claude-code-bin / `audit:original`
2. `npm run restore:product-main`  
   - **再次** `build:main`，保证 asar 内是产品 main（`app://` / LoginDesktop），不是官方 1p→claude.ai
3. `npm run build:product-web`  
   - 构建 `../open-claude-web` → `resources/product-web`
4. `prepare:electron-zip` + `electron-forge package`（主机平台）
5. `align:bundle`  
   - **macOS**（`align-packaged-macos-bundle.mjs`）：  
     拷官方 MacOS / Frameworks / Resources residual → **product-web 覆盖** `Contents/Resources/ion-dist` → 注入 `claude-code-bin` → 产品 bundle id / ad-hoc codesign  
   - **Windows**（`align-packaged-win32-bundle.mjs`）：  
     **product-web 覆盖** `resources/ion-dist` → 注入 `claude-code-bin` → 去掉多余的 `resources/product-web` 目录（加载只认 ion-dist）  
     （无 mac 式 residual .app Frameworks 叠加；exe 名保持 forge `Claudex.exe`）
6. `audit:bundle`  
   - mac：residual 外层 + 产品身份 + asar integrity + **产品 main 指纹** + asar 无工作区污染  
   - win：`Claudex.exe` / app.asar / **ion-dist 非 spa-dev** / 产品 main / runtime 必选 / `claude-code-bin/claude.exe`

**asar 内容 allowlist**（`forge.config.cjs`）：只打 `package.json` + `.vite/**`。  
- **禁止** workspace 根 `index.js`（常是 ~12MB 官方 residual dump，不是产品 main）。  
- 产品入口：`package.json` → `.vite/build/index.pre.js`。  
- `node_modules` 由 align 注入：`scripts/inject-packaged-asar-runtime.mjs`  
  - mac：写入 asar 后删除 `resources/original-runtime-node_modules`  
  - win：写入 asar **并保留** extraResource runtime 树（`originalRuntimeModules` 候选路径）  
- **禁止** `.dev-user-data` / smoke / docs / vendor / tmp 进 asar。

### macOS 产物示意

```text
out/Claudex-darwin-<arch>/Claudex.app
  Contents/MacOS/Claude
  Contents/Resources/ion-dist/   ← 产品 web（data-build-id=react-shell）
  Contents/Resources/app.asar    ← 产品 main（chunks 指纹）+ 官方 preload/renderer shell
  Contents/Resources/claude-code-bin/
```

打包后强制检查（`package-product` + `audit:bundle`）：

- `ion-dist` `data-build-id` ≠ `spa-dev`
- asar 产品 main 指纹（`chunks/` 或小入口 + product markers；禁止官方 ~12MB monolith）
- mac：`CFBundleIdentifier` + codesign Identifier = `com.local.claudex.desktop`
- win：`resources/claude-code-bin/claude.exe` 存在

### Windows 产物示意

```text
out/Claudex-win32-x64/           # 或 win32-arm64
  Claudex.exe
  resources/
    app.asar
    ion-dist/                    ← 产品 web（align 注入，非 spa-dev）
    claude-code-bin/
      claude.exe
      manifest.json
    original-runtime-node_modules/   # forge extraResource；audit 会查
    …
```

## 测试 / 开发（两平台相同）

```bash
# 终端 1：web
cd ../open-claude-web && npm run dev   # :5176

# 终端 2：壳
cd open-claude-desktop && npm run dev  # CLAUDE_DESKTOP_MAIN_VIEW_URL=http://localhost:5176
```

- `npm run dev` 默认 `http://localhost:5176`（见 `scripts/dev-electron.mjs`）。
- 不要与打包版同时占同一 userData：默认都是产品名 **Claudex** 的 Application Support / `%APPDATA%`，单实例锁会让后启动的进程秒退。

## 打开打包结果

```bash
npm run package:open                 # 启动打包产物（mac open .app / win spawn exe）
npm run package:open -- --isolated   # 独立 .package-user-data
npm run package:open -- --kill-dev   # 先尝试结束本仓库 dev Electron
```

- 打包路径**永不**设置 `CLAUDE_DESKTOP_MAIN_VIEW_URL`。
- Windows 也可直接：`out\Claudex-win32-x64\Claudex.exe`（注意与 dev 单实例）。

## Smoke

```bash
npm run smoke              # 开发壳 + 隔离 .smoke-user-data；默认 http://localhost:5176
npm run smoke:packaged     # 打包二进制 + 隔离 .smoke-user-data-packaged
```

| | 可执行 | 环境 |
|--|--------|------|
| smoke | Electron CLI + 项目 `.` | 注入 `MAIN_VIEW_URL`（默认 :5176） |
| smoke:packaged mac | `Contents/MacOS/Claude` | **删除** `MAIN_VIEW_URL`，走 app:// |
| smoke:packaged win | `out/Claudex-win32-<arch>/Claudex.exe` | 同上；校验 `resources/claude-code-bin/claude.exe` |

## Residual 同步（可选，主要服务 mac 对齐）

官方 residual 默认 vendored：

```bash
npm run sync:residual   # → resources/original-claude.app + resources/ion-dist
```

路径解析：`scripts/originalAppPaths.mjs`（优先 `resources/original-claude.app`）。

Windows 打包**不**依赖 mac residual 的 MacOS/Frameworks 拷贝；仍需要：

- `resources/product-web`（`build:product-web`）
- `resources/claude-code-bin`（含 **claude.exe**，`copy:claude-code-binary` 在 win 主机应产出 top-level `claude.exe`）
- `resources/original-runtime-node_modules`（`copy:original-runtime`；win 会补 win32 native / 安全 loader）

## 启动时序（app://、首屏、Dock）

- `registerAppProtocolScheme()` **必须**在 `app.whenReady()` 之前。
- `installAppProtocolHandler()` **必须**在建窗 **之前**安装，否则 macOS `activate` 可能提前 `createAndLoadWindow` → `ERR_FAILED (-2) loading 'app://localhost'`。
- **官方 residual**：`BbA()` GrowthBook **不 await** 建窗；`prr(ion-dist)` 装协议后 `vst()` + `loadAll()`。主窗 `opacity:0`，`mainWindow` shell `did-finish-load` +50ms 再 `setOpacity(1)`；mainView 背景透明，底下是 `I8()` 暖灰 `#fdfdfc` / 暗 `#1f1f1e`。
- **产品对齐**：GrowthBook / Chrome Kir **后台**启动，**禁止**在 `createAndLoadWindow` 前 `await` 网络刷新（1p fetch 失败可达 ~10s 超时 → 慢启动 + 长时间空帧）。
- `loadAll` 对 `app://` 的 `ERR_FAILED` 会重试一次（兜底）。
- 首屏“白一下”：壳已亮、`index-*.js`（产品 ~5MB）解析/执行前 mainView 仍透明，会露出窗口背景色——与 residual 同模式，不是协议失败。
- **登录链路（对齐官方 residual）**：
  - 主窗创建：`defaultWidth/Height 1200×800`，`opacity:0`，`backgroundColor` I8，mainView transparent；shell `did-finish-load`+50ms `setOpacity(1)`。**不要**按登录预创建 600 窗。
  - loadAll：`or()` 式 base（产品 app:// 或 dev Vite）+ sidebar → `/task/new`|`/epitaxy`（与官方 vst loadAll 同构）。**壳层不 force `/login`**。
  - SPA Pos：`isLoading` → `null`；`isLoggedOut` → `/login`（产品 `loginGate`：pending=`null`，logged_out 画 LoginDesktop）。
  - bootstrap 失败：`loginGate=unknown` → Yrs 式 `BootstrapConnectionErrorPage`（**禁止**挂 DesktopFrame）。
  - LoginRoute jn：挂载后 `resize(600,600,{center:true})`，pagehide/cleanup → `1200×800`。**window-state 不持久化 600×600** 登录瞬态。
  - stream-diag 默认关；`CLAUDE_DESKTOP_STREAM_DIAG=1` 才开。
  - **已激活 3p** 不得在 pending 时画登录窗。GrowthBook = 官方 BbA 后台跑，禁止建窗前 `await`。
  - asar integrity 用 **header sha256**（`asar.getRawHeader`），不是整文件 hash；改 asar 后要对主 Info.plist + Helper plists 同步再 codesign。交付优先完整 `npm run package`。
- Dock 图标：`CFBundleIconFile=electron.icns`（LaunchServices）；Electron `nativeImage` **读不了** 官方 residual 这套 ic07-only icns → 空图。产品用 residual 同 bitmap 抽出的 `resources/electron-app-icon.png`（`iconutil`）做 `dock.setIcon`。mac align 在 residual Resources 覆盖后会再注入该 PNG。

## 常见错误

| 现象 | 原因 | 处理 |
|------|------|------|
| 窗口是 Google / email 登录 claude.ai | 装了官方 shell main，或旧包 | `npm run package`（含 restore:product-main） |
| 包是 spa-dev 官方 SPA | align 未注入 product-web | 确认 `build:product-web` + align 日志 `productWebInjected: true` / `ionDistBuildId` |
| 打包秒退 | dev Electron 占单实例 | 退出 dev，或 `package:open -- --isolated` / `--kill-dev` |
| forge `fonts` 冲突 | electron dist 被 residual 污染 | `prepare:electron-zip` 会清 symlink；必要时删 `.electron-cache/local/*.zip` 重建 |
| asar 体积几百 MB / 含 user-data | forge ignore 过松打进工作区垃圾 | `forge.config.cjs` allowlist；audit 查 pollutionHits |
| `make` 无 package 后置指纹 | make 不跑 package-product 的 post-check | 产品交付优先 `npm run package`；或 make 后再 `node -e` 指纹 / audit |
| win smoke 报 claude.exe 缺失 | 未在 win 上 copy CLI 或 align 未注入 | 在 Windows 跑 `npm run copy:claude-code-binary` 后重 `package` |
| 在 mac 上找 win 产物 | host-native 未跨编 | 到 Windows 机器执行 `npm run package` |
| win 仍见 `resources/product-web` | 旧包 | 重跑 align（会删 leftover product-web，只保留 ion-dist） |
| `ERR_FAILED (-2) loading 'app://localhost'` | 协议 handler 装得太晚 / 首屏 race | 确认 `installAppProtocolHandler` 在 whenReady 后立刻调用；load 有一次 retry |
| `[appIcon] electron.icns empty` | Chromium 解不了 residual icns | 提供 `resources/electron-app-icon.png`（从 icns `iconutil` 抽出）；align 注入 |
