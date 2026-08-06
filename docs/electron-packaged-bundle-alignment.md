# Electron packaged bundle 对齐审计

生成时间：2026-08-06T02:25:17.250Z

## Windows packaged 结论

- exe 存在：是
- app.asar 存在：是
- product-web 存在：是
- product-web data-build-id：react-shell（禁止 spa-dev）
- residual ion-dist 存在：是
- residual ion-dist data-build-id：spa-dev
- dual-root 通过：是（ok）
- 产品 main 指纹：是（ok）
- original-runtime-node_modules 存在：是
- Claude Code binary 存在：是
- Claude Code binary 大小：147862528
- Claude Code manifest 存在：是
- runtime 必选缺失数：0
- runtime 可选缺失数：0
- app.asar 含 .vite 主入口：是
- app.asar 含 preload：是
- app.asar 是否误打入 smoke user data：否
- 是否通过：是

说明：Windows package 在 win32 主机生成；加载 `app://` dual-root → `resources/product-web` 主 SPA + `resources/ion-dist` residual（setup-desktop-3p）。macOS 外层 residual 对齐仅在 darwin .app 产物存在时审计。
