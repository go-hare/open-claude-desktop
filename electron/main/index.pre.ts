import { bootstrapDesktopApp } from "./index";

void bootstrapDesktopApp().catch((error) => {
  console.error("Claudex Desktop failed to launch", error);
  process.exitCode = 1;
});
