# 原版优先对齐报告

生成时间：2026-07-08T09:27:59.805Z

## 硬标准

1. JS/CSS/字体先找原版资源，不能自己猜。
2. 页面组件结构以原版 route chunk 与 decompiled 文件为依据。
3. 组件库不得自行替换；新增 UI 依赖必须在原版 package.json 中存在且版本一致。
4. Electron 主进程转源码时，未找到原版证据的行为必须标成 inferred，不能宣称已完全对齐。

## 当前检查结论

- ion-dist 字节级一致：是（原版 1555 / 当前 1555）
- .vite 壳资源一致：是（允许源码入口差异：build/index.js, build/index.pre.js）
- 字体文件数：72
- CSS 文件数：21
- route chunks 有资源：152/152
- route chunks 有 decompiled 证据：152/152
- 未授权 UI 依赖：0
- UI 依赖版本不一致：0
- 结论：通过

## 关键桌面路由证据

| route | 原版 chunk | chunk 存在 | decompiled 文件 | decompiled 存在 |
|---|---|---|---|---|
| desktop_landing | assets/v1/c71860c77-o4uW2kNW.js | 是 | claude-ion-react-workbench\decompiled\c71860c77-o4uW2kNW\deobfuscated.js | 是 |
| setup-desktop-3p | assets/v1/c71860c77-BOaDa5w5.js | 是 | claude-ion-react-workbench\decompiled\c71860c77-BOaDa5w5\deobfuscated.js | 是 |
| device-code-verify | assets/v1/c2ab4f27a-BT9l0ItR.js | 是 | claude-ion-react-workbench\decompiled\c2ab4f27a-BT9l0ItR\deobfuscated.js | 是 |

## 组件库/样式证据

- React: `assets/v1/c1a1184fb-D3W5hOMJ.js`, `assets/v1/c30db9bec-DHKJ3QLM.js`, `assets/v1/c43c5949a-vQe16vbD.js`, `assets/v1/c5da08b62-CJhbL6NF.js`
- react-intl: `assets/v1/a0911e9fb5d7528b1ca8bdcada4f28a453120e6d34255e29-JmXwavG5.js`, `assets/v1/c009a87a0-BppDfQ-y.js`, `assets/v1/c0243d234-BHUzHV1X.js`, `assets/v1/c029a409d-B0o81d6z.js`
- Tailwind utility CSS: `assets/v1/a0911e9fb5d7528b1ca8bdcada4f28a453120e6d34255e29-JmXwavG5.js`, `assets/v1/c009a87a0-BppDfQ-y.js`, `assets/v1/c029a409d-B0o81d6z.js`, `assets/v1/c0659e756-Cip3IoDf.js`
- Radix-style primitives: `assets/v1/c0e33db81-BcpYGiHp.js`, `assets/v1/c1a1184fb-D3W5hOMJ.js`, `assets/v1/c32c0d97f-BjI0Knrv.js`, `assets/v1/c5f4e1303-CSqThUeQ.js`
- Headless UI traces: `assets/v1/c5f4e1303-CSqThUeQ.js`, `assets/v1/ca30e9e0c-C3yPj1FH.js`, `assets/v1/ca768caa9-D20-r2DS.js`
- Phosphor/icon layer: 未命中

## 失败项

- 无

机器可读报告：`docs/original-first-alignment-report.json`
