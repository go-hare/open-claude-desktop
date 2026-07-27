# hare-code 项目硬规则

## Claude Desktop 1:1 还原硬规则

本项目当前目标是 1:1 还原官方 Claude Desktop / Claude Code 桌面端体验。

### 关键路径

- 桌面壳：`open-claude-desktop`
- Web 渲染：`open-claude-web`
- 官方 App：`/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents`
- 官方前端资源：`/Users/apple/Downloads/Claude code 汉化mac桌面版/Claude-Deepseek.app/Contents/Resources/ion-dist`

### 禁止事项

- 禁止凭截图、感觉或“接近效果”手写近似 UI。
- 禁止在官方 CSS / 静态资源已经存在时，通过额外补 CSS 来掩盖结构问题。
- 禁止把官方已有组件改成自造组件、近似组件或临时拼装组件。
- 禁止在未读取官方 `ion-dist` JS 的情况下修改布局、菜单、弹窗、composer、会话渲染、流式输出、权限模式、模型选择、worktree / branch 等逻辑。
- 禁止发现样式不一致后直接调 margin、padding、font-size、shadow、border-radius 等表层样式。

### 必须执行

1. 修改任何 Claude Desktop 还原相关 UI / 逻辑前，必须先从官方 `ion-dist` JS 定位对应组件、状态、className、DOM 层级、Portal / Popover / Dialog 挂载方式与事件流。
2. 如果 CSS 和静态资源来自官方但显示不一致，优先判定为以下问题：
   - DOM 结构不一致
   - className 组合不一致
   - Radix / Base UI / Portal / data 属性不一致
   - 状态机或渲染分支不一致
   - 数据加载与流式更新时序不一致
3. 发现之前写过的近似实现、猜测实现、补丁式样式或非官方结构时，先删除或回滚，再按官方 JS 转正。
4. 需要说明依据时，必须给出官方 JS 文件名、关键字符串 / 函数 / 组件名，以及我们对应文件。
5. 改完必须用桌面端实际启动验证，不得只凭构建通过声称完成。
6. 代码要组件化，避免继续把大型页面文件越写越大；能抽组件就抽组件，避免大文件堆叠。

### 判断标准

目标不是“看起来差不多”，而是：

- 组件结构对齐官方
- 功能状态对齐官方
- 弹层位置和交互对齐官方
- 流式输出与加载逻辑对齐官方
- macOS / Windows 平台分支对齐官方
- 只在官方确实没有覆盖的适配层做最小桥接

### 本机 host-loop 与 VM dual-exec

- **默认产品路径是本机（host-loop）**，不要为日常 Code / Cowork 会话强行走虚拟机。
- **Local Code 会话**（`claudeCliRunner.spawnClaude`）永远在本机 spawn 自带 CLI（`resources/claude-code-bin`），与 dual-exec 无关。
- **Cowork**：`hostLoopMode: true` → 本机 SDK / host spawn；`hostLoopMode: false` → dual-exec guest + 可能 `startVM`。
- 产品 GrowthBook kni（3p residual）默认打开 host-loop flag `1143815894`；无 `requireCoworkFullVmSandbox` / `forceDisableHostLoop` 时新会话应为本机。
- **VM / dual-exec 代码必须保留**（官方 residual 对照与可选策略路径），禁止以“只要本机”为由删除 `coworkVm` / dual-exec 实现。
- 未显式走到 dual-exec 时，不得把 guest 路径、guest 二进制、VM 挂载问题当成当前默认路径的阻塞。

### 桌面第三方推理与 CLI 配置

- 菜单「配置第三方推理…」→ `setup-desktop-3p`。
- **官方多配置 residual（主源）**：`userData/configLibrary/`  
  - `_meta.json`：`appliedId` + `entries[{id,name}]`（UUID id）  
  - `{uuid}.json`：完整 enterprise bag（含 `inferenceGatewayBaseUrl` / key / **`inferenceModels`** 等）
- 产品实现：`custom3pConfigLibrary.ts` + `Custom3pSetup` list/read/write/create/setApplied/reveal。
- **遗留**：`desktop-shell-settings.json` 的 `custom3pConfigs` 仅作空库时一次性 migrate；**不要**再当 Setup 主写路径。
- 官方 `claude_desktop_config.json` 是 preferences / MCP 等；**不要**把桌面 3p 主源说成 `~/.claude/settings.json`。
- 官方 spawn residual：`HFi` / `G4` + provider `sessionEnvVars` — **主进程注入 env**，CLI 不自己读库文件。
- 产品对齐：`custom3pCliEnv.buildClaudeCliSpawnEnv` 供 local `spawnClaude` 与 Cowork host-loop `options.env` 使用。
  - 3p：`CLAUDE_CODE_ENTRYPOINT=claude-desktop-3p`，`ANTHROPIC_BASE_URL` / key 等来自 applied bag。
  - bag 只有 `inferenceProvider`、无 baseUrl/key 时：只注入 entrypoint + host-managed 标志，**不得伪造 URL**，也不得用 process 继承的 BASE_URL 冒充 userData 配置。
- dual-exec guest 若将来启用：host `options.env` 不等于 guest 一定吃到；需 guest spawn 转发 / secrets 挂载。默认本机路径不依赖这一层。

### 1p / 3p 部署模式（N1e residual）

- 官方：`Hzt`（activation）→ `SM`/`deploymentModeIs3p` → `N1e`/`initDeploymentMode` → `hai`(1p) / `Cai`(3p)。
- 产品：`deploymentMode.ts` + `resolveDeploymentModeFromUserData(userData)` 读 **configLibrary applied bag**（shell 遗留可 migrate）。
  - **无** `inferenceProvider` / 有效 `bootstrapUrl` → **1p**：`/api/bootstrap` **不合成** account uuid（logged-out；`account: null`）。
  - **有** activation → **3p**：合成 `cowork_3p_*` account；缺 key/url → `degraded`（Setup 可修），**仍是 3p** 不是 Anthropic 登录。
  - `preferences.deploymentMode === "1p"` 且未 `disableDeploymentModeChooser` → 即使有 3p 键也走 1p。
- **禁止** `listConfigs` 空袋时自动 `createCustom3pConfig({ inferenceProvider: "gateway" })`（会假激活 3p）。
- health / login-desktop status / bootstrapState 一律从 resolution 派生，不得写死 healthy。
- 产品 **不发明** 官方 Anthropic OAuth 登录成功；1p logged-out 只保证 bootstrap 身份态对齐。

### dotClaude 模式（产品扩展，无官方 residual）

- `preferences.deploymentMode === "dotClaude"`：直接用用户已有 `~/.claude` CLI 配置运行，**不迁移、不复制**到 configLibrary。
- 探测：`detectDotClaudeCliConfig()`（`deploymentMode.ts`）读 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN|API_KEY`；只读，绝不写该文件。
- 分辨率：`resolveDeploymentMode` 把 dotClaude 映射到 3p shell（合成 `cowork_3p_*` 账号过 gate）；配置消失 → degraded，登录页回退普通 chooser。
- spawn 直通：`buildClaudeCliSpawnEnv` 在 dotClaude 下**不注入 bag 也不压制 ~/.claude 继承**，只加 `CLAUDE_CODE_ENTRYPOINT=claude-desktop-3p` + host-managed flags；路由/模型/密钥完全由 CLI 自己解析。
- 登录页：`getLoginDesktop3pStatus` 带 `dotClaude:{available,host,model}`（不含密钥）→ web 第三张卡「Continue with ~/.claude」。
- health：`recomputeConfigHealth` 在 dotClaude 下返回 `not_testable`（banner 隐藏；「打开设置修复」对 CLI 配置无意义）。

### 1p 主窗口 / 登录页（LoginRoute + LoginDesktop）

- 官方 **尺寸**：LoginRoute（`c632c9594-Bv5AdbQY.js` `jn`）对**主窗口** `resize(600,600,{center:true})`，离开时 `resize(1200,800)`。**不是**新 BrowserWindow。520×340 只是 Verify sign-in code；900×720 是 Setup。
- 官方 **双卡**：有 `provider||bootstrapHost` → `M5t({status})`（不传 hide1p）；`hide1p ?? !enabled` → dual。文案/结构：Ace `!w-12`、Continue with Gateway + E5t「Local configuration」pill、Sign in to Anthropic（Lce）、footnote。`T5t` 才是 `hide1p:true` portal。
- 官方 status `hgr`：`enabled:!IHe(enterprise)`（非 mode===3p）。
- 产品：主视图仍 open-claude-web；`/login` → `LoginDesktopPage` + resize；`windowHandlers.resize` 支持 `{center:true}`；不伪造 OAuth。
- 官方 **Sign out**（账号菜单 Gns）：`j=!!EQt()` →「Sign out」`xXbJsopyfR` → `NQt("clear")` → `pot/got/jsA(void)` + relaunch。产品：`SidebarFooter` + `deletePreference("deploymentMode")`；`setDeploymentMode` 只在 settingsHandlers 注册（featureHandlers 不得覆盖）。