import fs from "node:fs/promises";

await fs.rm(new URL("../.vite", import.meta.url), { recursive: true, force: true });
