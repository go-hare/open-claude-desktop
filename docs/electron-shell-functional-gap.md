# Electron 壳功能对齐审计

生成时间：2026-08-03T09:26:57.303Z

## 结论

- 原包 build 壳入口镜像：完整
- 当前 build 壳入口：完整
- 当前 preload invoke 通道是否与原包完全一致：是
- packaged app.asar 的 .vite/build + .vite/renderer 条目是否与原包一致：未检测
- 当前原包 runtime native/node modules 是否完整：是
- packaged 原包 runtime native/node modules 是否完整：是
- 运行时 real handlers：577
- 运行时 fallback handlers：0
- 原包 preload invoke 通道数：544
- 原包 preload sendSync 通道数：15
- 原包 renderer 监听事件通道数：75

## 当前策略

默认 build 使用“source main process + 原包 compiled preload/renderer/secondary shell resources”。这样先保证壳暴露面与原包一致；后续再逐项把 compiled JS 转成可维护 TypeScript。

## 当前完成面

- 原包二级窗口、worker、MCP runtime 静态资源、自定义协议入口已随 build/package 镜像进入当前壳。
- 原包 IPC invoke/sendSync 入口已全部由 source main process 注册为 real handler；运行时 active fallback 为 0。
- LocalSessions / LocalAgentModeSessions 方法已全部有显式实现，source 中 explicit unavailable / unsupported fallback 已清零。
- **Product-owned secondary shells / workers（非 vendor seed）**：`window-shared.css`（`electron/renderer-shell`）、`directMcpHost` / `nodeHost` / `shell-path-worker` / `transcript-search-worker`（`electron/workers`，`build:workers`）。`dev:build` 也会 rebuild workers。
- **custom3p Direct MCP OAuth（产品化）**：`persist:custom3p-mcp` session fetch、loopback authorize、`authorizeDirectMcpServer` / status push、`setMcpServerConfigs` → `connectFromConfigBag` hot-reload、product-web Connectors（mQe/hQe）。**不是** Anthropic 账号 OAuth / Subscribe / BFF。
- **Custom3pSetup MCP probe（产品化 1:1 residual Bot/Qot/xv）**：`custom3pMcpProbe.ts` → `probeMcpServer` / `authorizeAndProbeMcpServer` / `forgetMcpOAuth` 经 `settingsHandlers` 注册；Client `custom3p-desktop` + listTools；oauth 走 session partition + interactiveAuthorize；非 HEAD invent / 非 `forgetMcpOAuth → true` 假成功。
- **Custom3pSetup 边角 1:1**：`getInitialBootstrapStateState` → `custom3pBootstrapState`；`openDeviceCodeWindowForE2e` 仅 `CLAUDE_CDP_AUTH` 时开 520×340 `/device-code-verify`（非 `=> true`）。
- **LocalPlugins OAuth/env/shim（产品化 residual）**：`localPluginOAuthStore`（`cowork-plugin-oauth` / `cowork-plugin-env` / `cowork-enabled-cli-ops`）+ `localPluginOAuthService` + **`localPluginOAuthFlow`（i6t/NbA/n6t/r6t）**。`startPluginOAuthFlow`：PKCE S256 + `127.0.0.1` ephemeral loopback + `net.fetch` token POST → **`git()` 写 camelCase `accessToken`**；缺 endpoint / 交换失败诚实 error，**禁止**无 token 的 `success:true`。
- **sessions bridge 壳 residual（1:1 形状 + z6i client）**：官方 custom-3p/`1p` — `getBridgeConsent`/`getSessionsBridgeEnabled` 为 **boolean**；`set/kick/reset/abandon/preflight` 为 **void**；`sessionsBridgeStatus` 仅 yit/QcA（**无** invent `status`/`reason`/`enabled`）；`deleteBridge*` 无 client 时 **false**；`bridge-state.json` 含 enabled/userConsented/environmentId/remoteSessionId。**产品化**：`sessionsBridgeApi` (C6i) + `sessionsBridgeClient` (z6i poll/register) + `sessionsBridgeLifecycle` (nTA/lIr/NJ，gate `3572572142` 默认 off；3p shouldEnable=false 不启 client)。**禁止** invent ready / Anthropic OAuth 假 token；session work 仅 emit（不 invent v2 transport）。
- **mcpb / dxt 本地安装（portable）**：`installDxtArchive` **fflate 解包**到 `extensions/<local.mcpb|local.dxt.*>`；官方 GeA residual：**必须** `manifest.json`（name + manifest_version|dxt_version），**禁止**无 manifest 的 basename invent；`installDxtFromDirectory` 走 `installUnpackedExtension`；`uploadPlugin` 路径接受 `.zip/.mcpb/.dxt` 作 zip（插件侧需 plugin.json）；**不发明**远端 marketplace catalog。oce 仍仅 portable 本地 org-plugin 扫描。
- **Extensions gates（HN/YPA/L6e/b6e 产品化）**：`extensionEnableGates.ts` → `isExtensionsEnabled`/`isDirectoryEnabled`/`isDesktopExtensionSignatureRequired`/`isDesktopExtensionDirectoryEnabled`；`refreshAllowlistCheck` 无 org policy backend 时诚实 no-op（不 `=> true`）。
- **CoworkRadar Cards residual**：`dismissCard`/`setCardStatus`/`recordCardEngagement` → `false`（官方无 radar 后端时）。
- **OfficeAddin residual**：`isFeatureEnabled` → `louderPenguinEnabled === true`（SSA 默认 false）；`updateActiveConversationSummary` no-op。
- **setThemeMode residual**：`nativeTheme.themeSource` + `user-theme-mode.json`（Yi userThemeMode）；ready 时 restore。
- **isClaudeCurrentlyHealthy residual**：`ocr` → `net.fetch(app://localhost/healthcheck)` status === `"healthy"`；失败/destroyed → false。
- **cancelPendingRestart residual**：`pendingRestart.ts` sb 清 N2 canceler。
- **handleMentionSelect residual（uir）**：`file-` → `{ chipText: basename }`；无 window metadata 时 honest additionalText。
- **FindInPageProvider residual**：pending map + `setProviderActive` clearSelection / clear pending；`reportFindResult` resolve requestId。
- **FramebufferPreview residual（无 RFB 时官方 empty stub）**：`listSources→[]`；`requestFramePort→false`；`attach` throw `FramebufferPreview not available in this window`；`detach`/`sendKey`/`sendPointer`/`sendScroll`/`setStreamHints` → void no-op（**不是** `=> true` 假成功）。真 RFB/VNC MessagePort 未产品化前保持此墙。
- **Computer Use Darwin executor residual（cTi / koA / ddi）**：`computerUseDarwinExecutor.ts` → `createDarwinExecutor` + `createComputerUseHostAdapter`；`claude-swift.computerUse`（`computer_use.node`，独立于 overlay gate）+ `claude-native` keys/mouse；`coworkComputerUseMcpServer` action tools 经 `@ant/computer-use-mcp` `bindSessionContext`/`handleToolCall`。native 缺失时诚实 refuse（不发明截图）。Win32 `createWin32Executor` 未产品化。FramebufferPreview（RFB）与 Chicago CU 分线。
- **Computer Use IFi session residual（Mac）**：session bag 持有 `cuAllowedApps`/`cuGrantFlags`/`cuSelectedDisplayId`/`cuLastScreenshotDims`（IXi 持久化）+ runtime `cuHiddenDuringTurn`/`cuHiddenPendingNote`/`cuClipboardStash`/`cuDisplayPinnedByModel`；`computerUseLock`（$ki/vc）check/acquire/release；leavingRunning → `clearCoworkSessionEphemeralsOnLeavingRunning`（`chicagoAutoUnhide` 时 P_A unhide + clipboard stash restore + lock release）。prefs：`chicagoEnabled` + `chicagoAutoUnhide`（SSA 默认 true）。
- **Computer Use Esc residual（Mac，Xki/Wki/Zki/zki/zv）**：`initComputerUseEsc` 在 desktop bootstrap；lock acquire → `globalShortcut.register("Escape")`；release → unregister；模型合成 Esc（executor key/holdKey）走 `markModelSynthesizedEscape`（zv）吸收；用户 Esc → `stop(sessionId)` holder。
- **Computer Use 真机会话路径（Mac，权限已开 2026-08-04）**：Electron 产品路径 E2E PASS — product TCC granted/granted；`request_access` permission card 触发并 grant Notes+Finder；`list_granted`；`screenshot` 真实 JPEG + dims；`cursor_position`；`open_application` Notes；lock 持有期间 Esc 注册；zv 吸收模型 Esc；用户 Esc stop holder + unregister。Win32 仍非本机目标。
- **Computer Use residual 接线（Mac，2026-08-04 续）**：
  - IFi `getUserDeniedBundleIds` → `settings.chicagoUserDeniedBundleIds`（`registerDesktopIpc` → manager → runtime → MCP bag）。
  - `$5`/`oq`/`pZe`：`computerUseChicagoConfig.ts` 读 GrowthBook feature `1291166712`（fU）object keys；缺省 = CTi / `pixels` / teachMode true；host adapter `getSubGates` + MCP `coordinateMode`/`teachModeEnabled`。
  - `sFi`/`aFi`/`GUi`：`computerUseAppEnumeration.ts` 1s race + priority/noise/path 过滤；`buildComputerUseTools(..., installedAppNames)`。
  - **gFi await aFi（首包）**：chicago on + darwin + 冷 cache 时 `createQueryAsync` `await getCachedInstalledAppNamesForTools`（1s race）再 `buildComputerUseTools`；非 CU/暖 cache 保持 **sync createQuery**（fire-and-forget start 同 turn attach）。Zod wrap 用 `computerUseToolShapeForResidual` 保留 residual `apps.description`（含 `Available applications on this machine: …`），不再被共享 shape 丢掉。超时/ native 失败省略列表不发明。bootstrap `kickComputerUseAppEnumerationPrewarm` 仍保留。
  - `h9e`：`computerUseScreenshotPersist.ts` — `save_to_disk` 时写 `outputs/screenshot-<ts>.(png|jpg)` 并 unshift “Screenshot saved to: …”；无 outputs 不发明路径。
  - **Teach 全链路 residual（Ucr / IFi onTeach*）**：
    - session bag：`teachModeActive` / `teachModeEnteredAt`（**runtime-only**，不写 session JSON；与 IFi ephemeral 一致）。
    - manager `pendingTeachStep` + `resolveTeachStep` / `activateTeachMode` / `requestTeachStep` / `notifyTeachWorking` / `clearTeachModeOnLeavingRunning`。
    - MCP options：`getTeachModeActive` / `onTeachModeActivated` / `onTeachStep` / `onTeachWorking` 进 `bindSessionContext`。
    - teach permission residual：allow + `_cuGrants` → `userConsented:true`（empty `granted` OK）；package 门闩 `userConsented && (skipDialog∪granted).length>0`。
    - overlay：`computerUseTeachOverlay.ts` + product HTML + preload `computerUseTeach.js`；IPC `cu-teach:*`；hide main (Uq)；exit → resolve exit + `stop` lock holder。
  - **真机复验（2026-08-04 产品路径 + SPA）**：
    - Host/MCP：`list_granted` / `screenshot` / `open_application` / `cursor_position` / lock+Esc / `teach_step`→`onTeachStep`+`onTeachWorking` PASS。
    - **SPA（product-web）**：session `local_55c052…`；`request_access` always → granted=1；`request_teach_access` always → `Teach permission result: … userConsented=true (_cuGrants)` → **`[cu-teach] teachModeActive=true`**；主窗 hide 后 Electron 标题 **`Teaching`**；overlay DOM 有 Exit/Next（explanation 空因模型未带合法 schema）。
    - **teach_step schema host 探针**（`/tmp/cu-teach-step-schema-probe.json`）：错误 `text` 参数 → package 拒、**不**进 `onTeachStep`；`explanation`+`next_preview`+`actions` → `onTeachStep`+`onTeachWorking` PASS。SPA 多轮卡在模型缺字段，**不是**壳未激活。
    - 单测锁：teach bag / LocalAgent inventory / Direct MCP / oce 等 residual **32/32 PASS**。
  - **壳 IPC / 二级窗（对齐结论）**：
    - preload invoke **与原包一致**；runtime **577 real / 0 fallback**（`docs/electron-shell-runtime-coverage.md`）。
    - secondary：**product** `electron/renderer-shell/*` + `electron/preload/*` + workers；`ensure:secondary-shell` 优先产品源；`resources/shell-secondary` 仅 residual seed/fallback。
    - Direct MCP / custom3p OAuth / status push / oce portable：**已产品化**（非 Anthropic 账号 OAuth）。
  - **诚实非目标墙（禁止 invent 当对齐）**：
    - Win32 `createWin32Executor`（用户自有 Win 机）
    - RFB/VNC FramebufferPreview 真 MessagePort（官方 empty stub 已诚实；真接线是 dual-exec 预览 backlog）
    - Anthropic 账号 OAuth / Subscribe / BFF **假登录成功**
    - sessions bridge **v2 session transport invent**（z6i register/poll/client 已产品化；session work 仅 emit，不 invent secret decode / activeSessions 全图；无 token/gate 时不假 ready）
    - 远端 marketplace **catalog invent**（本地 zip/mcpb/dxt 解包已产品化）
    - 无 token 的插件 OAuth **假 success**（i6t 换票已产品化；失败仍诚实）
    - GrowthBook 远端 chicago_config 真值注入（缺省本地 residual 已用）
    - packaged asar vite 条目 vs 原包：**审计字段未跑**（非功能缺口）

## 后端依赖说明

部分能力本身依赖 Anthropic 云端、Claude VM bundle、Slack、远端 MCP/插件市场或硬件设备；当前壳已对齐入口和本地行为，外部服务是否可用取决于对应真实后端/凭据/设备。

完整机器可读报告见：`docs/electron-shell-functional-gap.json`
