# Claudex Desktop

**Claudex** 是 Claude Desktop 的开源桌面端重建：Electron 壳 + 自带 Claude Code CLI，日常写代码、跑会话、接第三方推理都能用。

> 非 Anthropic 官方产品。Claude / Claude Desktop / Claude Code 商标与权利归 Anthropic；本仓库仅供学习研究与自托管使用。

| 项目 | 说明 |
|------|------|
| 定位 | macOS / Windows 桌面 App（产品名 **Claudex**） |
| 配套前端 | [open-claude-web](https://github.com/go-hare/open-claude-web)（主界面 SPA） |
| 配套 CLI 思路 | 可与 [go-hare/claude-code-1](https://github.com/go-hare/claude-code-1) 等自托管链路配合 |
| 仓库 | https://github.com/go-hare/open-claude-desktop |
| 版本 | 见 `package.json`（当前如 `1.6608.2-claudex.0`） |

两个仓库要一起用：

| 仓库 | 干什么 |
|------|--------|
| **本仓库** open-claude-desktop | 窗口、菜单、会话进程、CLI、MCP、打包 |
| **open-claude-web** | 登录页、侧栏、Cowork / Code 主界面、设置 |

---

## 能干什么

| 模块 | 说明 |
|------|------|
| 桌面壳 | 独立 App 窗口，不是浏览器里凑合打开 |
| Code 会话 | 本机拉起自带 Claude Code CLI，写代码、改仓库 |
| Cowork | 协作式会话入口（默认本机执行，不强制虚拟机） |
| 第三方推理 | 菜单里配置 Base URL / Key / 模型列表，多套配置可切换 |
| 用已有 CLI 配置 | 可选直接沿用本机 `~/.claude`（不拷贝、不改写） |
| MCP | 扩展工具与会话侧能力（按桌面配置加载） |
| Artifacts 等 | 随功能开关与桌面能力暴露（有则可用） |

一句话：**桌面里像 Claude Desktop 那样开会话；推理可以走官方登录路径，也可以走自托管 / 网关。**

---

## 环境要求

- **Node.js ≥ 22**
- 建议两仓库**并列**放：

```text
somewhere/
  open-claude-desktop/
  open-claude-web/
```

---

## 快速开始（开发）

两个终端：

```bash
# 终端 1：界面
cd open-claude-web
npm install
npm run dev
# → http://127.0.0.1:5176

# 终端 2：桌面
cd open-claude-desktop
npm install
npm run dev
```

首次进入可能看到登录 / 模式选择：

- 配好第三方推理 → 走网关那一套  
- 或选本机已有 `~/.claude`  
- 1p 路径下不会假装已经登录成功（没有假 OAuth）

---

## 打包成 App

在 **本机对应平台** 上打本机包（在 Mac 上打 Mac 包，在 Windows 上打 Windows 包）：

```bash
cd open-claude-desktop
npm run package
```

打开刚打好的包：

```bash
npm run package:open
```

常见产物位置：

| 平台 | 路径 |
|------|------|
| macOS | `out/Claudex-darwin-<arch>/Claudex.app` |
| Windows | `out/Claudex-win32-<arch>/Claudex.exe` |

可选：把 `.app` 打成 zip 方便分发（自行 `ditto` / 压缩即可）。

冒烟（可选）：

```bash
npm run smoke            # 开发壳
npm run smoke:packaged   # 已打包二进制
```

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 开发启动（连 web 的 5176） |
| `npm run package` | 完整产品打包 |
| `npm run package:open` | 启动打包结果 |
| `npm run build:product-web` | 只重建界面进 `resources/product-web` |
| `npm run smoke` / `smoke:packaged` | 启动冒烟 |

---

## 配置说明（正常人版）

### 第三方推理

菜单里的「配置第三方推理…」：

- 多套配置存在应用自己的 **userData** 配置库里  
- 选中的那一套会在启动 CLI 时注入环境（Base URL、Key、模型等）  
- **不是**去改你的 `~/.claude/settings.json` 当主配置源

### 用本机 Claude CLI 配置

若选择 **dotClaude / 沿用 ~/.claude**：

- 只读你已有的 CLI 配置  
- 不迁移、不复制进桌面配置库  
- 适合已经在终端里配好代理 / 模型的人

### 默认怎么跑会话

- **Code / 日常会话：本机跑 CLI**，不默认开虚拟机  
- 虚拟机相关代码在仓库里保留，但是可选路径，不是开箱必走

---

## 边界（务必看）

- **不是** Anthropic 官方客户端，也不能保证与商店版二进制 100% 一致  
- 不会伪造官方 OAuth 登录成功、订阅、加余额等云端链路  
- 部分云端能力（远端 Sessions 等）会诚实关掉或空数据，而不是假数据骗 UI  
- 打包请在目标平台本机构建；跨平台交叉编译出「能跑的 win 包」不要指望  
- 版本以 `package.json` / 实际构建产物为准  
- 适合：自托管、二次开发、对照学习桌面 Agent 架构  
- 不适合：当官方合规替代品、硬刚企业审计口径

---

## 目录大概长什么样

```text
open-claude-desktop/
  electron/main/      # 主进程：窗口、IPC、会话、CLI
  electron/preload/   # 给前端的 bridge
  resources/          # 自带 CLI、打包用前端、运行时资源
  scripts/            # 开发 / 打包 / 冒烟脚本
  docs/               # 打包与测试等补充说明
```

界面源码在姊妹仓库 **open-claude-web**。

更细的工程约定写在 [`CLAUDE.md`](CLAUDE.md)；打包细节见 [`docs/package-and-test.md`](docs/package-and-test.md)。

---

## 相关链接

| 链接 | 说明 |
|------|------|
| [`CLAUDE.md`](CLAUDE.md) | 1:1 residual 硬规则、host-loop、3p/configLibrary、登录 residual |
| [`docs/package-and-test.md`](docs/package-and-test.md) | 打包 / 测试 / dual-root / smoke 全规范 |
| [`../open-claude-web/README.md`](../open-claude-web/README.md) | 产品 SPA 说明与开发命令 |
| `docs/electron-shell-*.md` / `*.json` | 壳覆盖、功能 gap、bundle 对齐报告 |
| https://github.com/go-hare/open-claude-desktop | 本仓库（桌面壳） |
| https://github.com/go-hare/open-claude-web | 主界面 SPA |
| https://github.com/go-hare/claude-code-1 | 配套 Claude Code 方向 |
| https://github.com/go-hare/agent-extension | 浏览器扩展（Claude in Chrome 方向） |
| [linux.do](https://linux.do/) | linux.do 社区 |

欢迎 star / issue / PR。有问题请尽量带上：系统与架构、是 `dev` 还是 `package`、日志片段、复现步骤。
