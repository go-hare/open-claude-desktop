# Claudex Desktop

Electron 桌面壳（产品名 **Claudex**），按官方 Claude Desktop `app.asar` / residual 资源重建。主 UI 由姊妹仓库 **[open-claude-web](../open-claude-web)** 提供。

| 仓库 | 职责 |
|------|------|
| **open-claude-desktop**（本仓库） | 主进程、preload、IPC、协议、会话/CLI/MCP、打包与 dual-root 资源 |
| **open-claude-web** | 产品 SPA（Login / Cowork / Code / Settings / Artifacts…） |

官方对照（本机路径，见 `CLAUDE.md`）：

- App residual：`…/Claude-Deepseek.app/Contents`
- 前端 residual：`…/Resources/ion-dist`

目标是 **1:1 residual 对齐**，不是“看起来差不多”的近似壳。

---

## 架构一览

```text
Claudex Desktop
├─ electron/main/**          产品主进程（TypeScript）
├─ electron/preload/**       preload / bridges（含 LocalAgentModeSessions 等）
├─ resources/
│  ├─ product-web/           产品主 SPA（open-claude-web 构建产物）
│  ├─ ion-dist/              官方 residual SPA（setup-desktop-3p 等，非主 UI）
│  ├─ claude-code-bin/       自带 Claude Code CLI
│  └─ original-runtime…     原包 native / node 运行时
├─ app.asar (.vite/build)    产品 main + 对齐后的 shell 入口
└─ custom schemes            cowork-artifact / cowork-file / app:// …
```

### 两条加载路线（禁止混用）

| 场景 | 命令 | 主视图 | Web |
|------|------|--------|-----|
| **打包** | `npm run package` → `npm run package:open` | `app://localhost` | dual-root：`product-web` + residual `ion-dist` |
| **开发 / 测试** | `npm run dev` | `http://localhost:5176` | open-claude-web Vite（`CLAUDE_DESKTOP_MAIN_VIEW_URL`） |

- 打包默认 **不得** 打开 `https://claude.ai`（1p 官方 mN 仅 debug：`CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1`）。
- residual `ion-dist` 只服务对照 + `/setup-desktop-3p`、`/device-code-verify` 等；**主 UI 永远是 `product-web` / Vite**。
- 完整规范：[`docs/package-and-test.md`](docs/package-and-test.md)。

### 部署模式（1p / 3p / dotClaude）

| 模式 | 含义（产品诚实口径） |
|------|----------------------|
| **1p** | 无 3p activation → bootstrap `account: null`（logged-out）；不伪造 Anthropic OAuth 成功 |
| **3p** | configLibrary applied bag 有 `inferenceProvider` 等 → 合成 3p 账号；缺 key/url 为 degraded |
| **dotClaude** | 直读用户 `~/.claude` CLI 配置（只读）；不迁移进 configLibrary |

- 多配置主源：`userData/configLibrary/`（官方 wrA residual），不是 `~/.claude/settings.json`。
- 默认会话路径：**host-loop 本机**；Local Code 永远本机 spawn CLI。VM / dual-exec 代码保留，不作为默认阻塞。

### 登录窗尺寸 residual

- LoginRoute：主窗 `resize(600,600,{center})`，离开后 `1200×800`（不是独立小窗，也不是默认真全屏）。
- 持久化 `window-state` 可恢复 maximize / fullScreen；冷启动默认仍是 1200×800 级。

---

## 快速开始

**要求：** Node `>=22`。

```bash
# 建议目录布局：两仓库并列
#   …/open-claude-desktop
#   …/open-claude-web

cd open-claude-desktop
npm install
```

### 开发（双终端）

```bash
# 终端 1：产品 web
cd ../open-claude-web && npm install && npm run dev   # http://127.0.0.1:5176

# 终端 2：桌面壳
cd open-claude-desktop && npm run dev
# 默认 CLAUDE_DESKTOP_MAIN_VIEW_URL=http://localhost:5176
```

### 打包并打开

```bash
npm run package
npm run package:open                 # 默认独立 userData（.package-user-data）
npm run package:open -- --no-isolated # 与 dev 共享默认 userData（可能抢单实例）
npm run package:open -- --kill-dev    # 先结束本仓库 dev Electron
```

| 平台 | 产物 | 可执行 |
|------|------|--------|
| macOS | `out/Claudex-darwin-<arch>/Claudex.app` | `Contents/MacOS/Claude` |
| Windows | `out/Claudex-win32-<arch>/` | `Claudex.exe` |

**Host-native：** 在 mac 打 mac 包，在 Windows 打 win 包。不要指望在 mac 上直接得到可用的 win32 运行包。

### Smoke

```bash
npm run smoke              # 开发壳 + 隔离 userData；默认注入 :5176
npm run smoke:packaged     # 打包二进制；不注入 MAIN_VIEW_URL，走 app://
```

---

## 常用脚本

| 脚本 | 作用 |
|------|------|
| `npm run dev` | 开发启动（默认连 Vite :5176） |
| `npm run build` | 主进程 + preload + 原包壳资源 + runtime + CLI 拷贝 + residual 审计 |
| `npm run package` | 产品打包流水线（restore main → product-web → forge → align → audit） |
| `npm run package:open` | 启动已打包应用 |
| `npm run build:product-web` | 构建 `../open-claude-web` → `resources/product-web` |
| `npm run restore:product-main` | 在 copy original shell 后重建产品 main，避免 asar 变成官方 1p loader |
| `npm run smoke` / `smoke:packaged` | 启动冒烟 |
| `npm run audit:shell` / `audit:bundle` / `verify:alignment` | 壳 / 包 / 对齐审计 |
| `npm run sync:residual` | 可选：同步官方 residual → `resources/original-claude.app` + `ion-dist` |

打包流水线细节见 `scripts/package-product.mjs` 与 [`docs/package-and-test.md`](docs/package-and-test.md)。

环境变量（节选）：

| 变量 | 用途 |
|------|------|
| `CLAUDE_DESKTOP_MAIN_VIEW_URL` | 开发主视图 URL（打包路径禁止设置） |
| `CLAUDE_PRODUCT_WEB_ROOT` | 覆盖 open-claude-web 路径 |
| `CLAUDE_PRODUCT_WEB_SKIP_BUILD=1` | 跳过 web 构建（复用已有 dist） |
| `CLAUDE_PRODUCT_WEB_STRICT=1` | product-web 走完整 `npm run build`（含 tsc） |
| `CLAUDE_FORCE_ANTHROPIC_MAIN_VIEW=1` | debug：强制官方 1p mN 主视图 |

---

## 源码地图

```text
electron/main/
  index.ts / lifecycle / windows / protocol / menu
  ipc/                 IPC 注册（sessions、settings、features、window…）
  services/
    coworkSessions/    Cowork 会话、MCP inject residual、host-loop
    localSessions/     Local Code / CLI spawn
    custom3p/          deploymentMode、configLibrary、CLI env
    mcp/               MCP runtime
    settings/          preferences、supportedFeatures
electron/preload/
  bridges/webBridge.ts  暴露给 web 的 bridge 面
shared/                主进程与 preload 共享类型/常量
scripts/               构建、打包、审计、smoke
docs/                  打包规范与审计报告
```

Web 侧对应：`open-claude-web/src/adapters/desktopBridge/`、`features/*`。

---

## 诚实边界（产品 delta）

以下 **有意不做假**，与官方 1p 云端行为不同：

- 不为 3p 伪造 Anthropic OAuth / Subscribe / AddCredits 成功链路。
- rate-limit 横幅保留官方 **action 槽位结构**，CTA 仅 residual-honest：`dismiss` / `reset limits`（若 bootstrap 允许）/ `Open Setup`（config degraded）。
- Sessions Bridge / 部分远端 Anthropic 能力：诚实 empty / disabled，不 soft-true 骗 UI。
- mcpCoordinator：**inject residual**（roots + create/reconcile 等），不是完整官方 `createAllServers` 克隆。
- dual-exec / VM 代码保留；默认产品路径仍是 host-loop。

---

## 验证清单（上线前）

1. **开发链路**：web `:5176` + `npm run dev` 能进登录/主壳，无空白主视图。
2. **打包链路**：`npm run package` 成功；`audit:bundle` dual-root OK（`product-web` ≠ `spa-dev`，residual `ion-dist` 仍在）。
3. **打包启动**：`npm run package:open`（isolated）冷启动；无 deploymentMode 时登录窗约 **600×600**。
4. **Smoke**：`npm run smoke:packaged` 返回 ok（主窗可见、`app://` 主视图）。
5. **功能抽样**：3p Setup / host-loop 会话 / rate-limit 横幅 CTA / Artifacts 列表与打开（feature 开时）。
6. UI 变更必须对照官方 `ion-dist` JS（见双方 `CLAUDE.md`），改完用**桌面实际启动**验证，不能只靠 tsc。

历史审计快照与数字会随构建变化，以当次 `audit:*` / `smoke:*` 输出为准。更细的对齐笔记见 `docs/` 与 web 仓库 `docs/official-alignment-map.md`。

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [`CLAUDE.md`](CLAUDE.md) | 1:1 residual 硬规则、host-loop、3p/configLibrary、登录 residual |
| [`docs/package-and-test.md`](docs/package-and-test.md) | 打包 / 测试 / dual-root / smoke 全规范 |
| [`../open-claude-web/README.md`](../open-claude-web/README.md) | 产品 SPA 说明与开发命令 |
| `docs/electron-shell-*.md` / `*.json` | 壳覆盖、功能 gap、bundle 对齐报告 |

## 链接
- [((https://linux.do/))](https://linux.do/) — linux.do 社区
