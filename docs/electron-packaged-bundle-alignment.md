# Electron packaged bundle 对齐审计

生成时间：2026-07-08T09:29:55.012Z

## Windows packaged 结论

- exe 存在：是
- app.asar 存在：是
- ion-dist 资源存在：是
- original-runtime-node_modules 存在：是
- Claude Code binary 存在：是
- Claude Code binary 大小：128822272
- Claude Code manifest 存在：是
- runtime 缺失条目数：0
- app.asar 含 .vite 主入口：是
- app.asar 含 preload：是
- app.asar 是否误打入 smoke user data：否
- 是否通过：是

说明：当前主机生成的是 Windows package；macOS 外层 bundle 对齐仅在 darwin .app 产物存在时审计。
