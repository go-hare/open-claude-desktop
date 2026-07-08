# Built-in @ant packages

These directories provide local `file:` packages for private official `@ant/*` dependencies.

- Packages that exist in the official installed `app.asar` are runtime proxies to `resources/original-runtime-node_modules`.
- Packages found in local official source are copied/built into `vendor/*/dist`.
- Packages whose private source is unavailable are source-owned protocol adapters, bundle-derived adapters, or compatibility shims.
- Do not publish these packages. They exist only to keep the desktop dependency baseline self-contained.
