function toLoggerDetail(detail) {
  return detail instanceof Error ? detail : void 0;
}
const DEFAULT_GRANT_FLAGS = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false
};
export {
  DEFAULT_GRANT_FLAGS,
  toLoggerDetail
};
