# Electron packaged bundle 对齐审计

生成时间：2026-08-03T09:32:30.578Z

## 结论（own forge Electron shell）

- 壳模型：own-forge-electron
- 产品二进制 Contents/MacOS/Claudex 存在：是
- 是否残留官方 MacOS/Claude 覆盖：否
- 产品身份（Bundle ID / Name / Executable）：是
- codesign Identifier 是否为产品 ID：是（com.local.claudex.desktop）
- 产品 Bundle ID：com.local.claudex.desktop（期望 com.local.claudex.desktop）
- CFBundleDocumentTypes 残差：是
- CFBundleURLTypes 残差：是
- Helpers/chrome-native-host：是
- Helpers/disclaimer：是
- smol-bin host：是
- locale en-US.json：是
- Electron Framework 存在：是
- Electron Framework 是否存在绝对 symlink：否
- app.asar integrity：是
- app.asar 产品 main 指纹：是（ok index=448 chunks=true）
- app.asar runtime node_modules 缺失数：0
- app.asar.unpacked runtime 缺失数：0
- product-web 存在：是（build-id=react-shell）
- residual ion-dist 存在：是（build-id=spa-dev）
- dual-root 通过：是（ok）
- 是否通过：是

说明：壳与 web 一样是我们写的产品代码 + forge Electron 运行时；选择性注入官方 residual Helpers（chrome-native-host/disclaimer）、smol-bin、locale JSON、document/URL types。不做官方 Claude.app MacOS/Frameworks 整段覆盖。CFBundleIdentifier/Name/Executable 为产品身份（Claudex）；app.asar 必须是产品 main；Resources dual-root：product-web 主 SPA + residual ion-dist（setup-desktop-3p）。
