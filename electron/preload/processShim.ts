export function createProcessShim(appVersion = "0.0.0") {
  return {
    arch: process.arch,
    platform: process.platform,
    type: process.type,
    versions: process.versions,
    version: appVersion,
    env: {},
  };
}
