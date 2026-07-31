# Electron packaged bundle 对齐审计

生成时间：2026-07-30T05:07:57.399Z

## 结论

- Claude 二进制 hash 对齐：否
- 生成的 Claudex 二进制是否已移除：是
- Info.plist 残差字段（Executable/Version）是否对齐原包：是
- 产品身份（Bundle ID / Name）是否独立于官方：是
- codesign Identifier 是否为产品 ID：是（com.local.claudex.desktop）
- 产品 Bundle ID：com.local.claudex.desktop（期望 com.local.claudex.desktop）
- 原包 Resources 配套项缺失数（不含 app.asar）：0
- Resources 额外项数：0
- Frameworks 缺失/额外：0/0
- Helpers 缺失/额外：0/0
- Electron Framework 是否存在绝对 symlink：否
- app.asar integrity 是否已重算：是
- app.asar 产品 main 指纹：是（ok index=448 chunks=true）
- app.asar runtime node_modules 缺失数：0
- app.asar.unpacked runtime 缺失数：0
- app.asar 是否误打入 smoke user data：否
- 是否通过：是

说明：外层 macOS Frameworks/Helpers/二进制对齐原包；CFBundleIdentifier/Name 必须是独立产品身份（不能等于 com.anthropic.claudefordesktop），避免与官方 Dock/TCC 合并；app.asar 必须是产品 main（chunks / 产品指纹），禁止官方 12MB 单文件 monolith。
