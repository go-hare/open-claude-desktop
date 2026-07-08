# Electron 壳功能对齐审计

生成时间：2026-07-08T09:28:32.535Z

## 结论

- 原包 build 壳入口镜像：完整
- 当前 build 壳入口：完整
- 当前 preload invoke 通道是否与原包完全一致：是
- packaged app.asar 的 .vite/build + .vite/renderer 条目是否与原包一致：未检测
- 当前原包 runtime native/node modules 是否完整：是
- packaged 原包 runtime native/node modules 是否完整：否
- 运行时 real handlers：562
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

## 后端依赖说明

部分能力本身依赖 Anthropic 云端、Claude VM bundle、Slack、远端 MCP/插件市场或硬件设备；当前壳已对齐入口和本地行为，外部服务是否可用取决于对应真实后端/凭据/设备。

完整机器可读报告见：`docs/electron-shell-functional-gap.json`
