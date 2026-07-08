function toLoggerDetail(detail) {
  return detail instanceof Error ? detail : void 0;
}
function localPlatformLabel() {
  return process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";
}
export {
  localPlatformLabel,
  toLoggerDetail
};
