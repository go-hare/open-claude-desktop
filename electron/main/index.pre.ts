import { bootstrapDesktopApp } from "./index";

void bootstrapDesktopApp().catch((error) => {
  console.error("Claude Deepseek Desktop failed to launch", error);
  process.exitCode = 1;
});
