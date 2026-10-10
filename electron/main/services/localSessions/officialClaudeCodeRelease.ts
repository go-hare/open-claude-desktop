/**
 * Official VOe residual (app.asar) — Ta userData pin, used as fallback when
 * `@go-hare/claude-code-*` native is missing. Local Query prefers go-hare native.
 */
export const OFFICIAL_CLAUDE_CODE_RELEASE = {
  version: "2.1.128",
  manifest: {
    version: "2.1.128",
    commit: "d6caed183d5f5b985cab02ef8c812d2abee9ecd9",
    buildDate: "2026-05-04T17:47:02Z",
    platforms: {
      "darwin-arm64": {
        binary: "claude.zst",
        checksum: "4a87c9d8b6546c232d1be9e192d6912cacee89d9e209cbdf2717b5a7b488078d",
        size: 44848059,
        bundle: {
          checksum: "b5fee793d11f4cc88cd1b353ea5749fde1740f6d9abd0fde34da6f4037a79d3e",
          size: 44847617,
        },
      },
      "darwin-x64": {
        binary: "claude.zst",
        checksum: "f5b432e54173ec5c5a0aa74c4a56ec4f82e7156ca2ee9c74f0b6cd2876b1eddd",
        size: 46559830,
        bundle: {
          checksum: "5d7b382dab3f21b9ec419bbc1ffc0a46f2e146fdaa8bbbad06273bde402a3516",
          size: 46571579,
        },
      },
      "linux-arm64": {
        binary: "claude.zst",
        checksum: "d64248f96a0c7621dc462ca66180f3925c447caeef5b8ac8bb0d167267798a45",
        size: 54376604,
      },
      "linux-x64": {
        binary: "claude.zst",
        checksum: "fe962c16d9766154722d657a6adcf7cf8f181d015b3276c343db25573226224e",
        size: 54959044,
      },
      "linux-arm64-musl": {
        binary: "claude.zst",
        checksum: "7141c50d86dbaa4a82f8eeaa22ded6c4ddb0f17a7dd461423cd758179ba35e26",
        size: 53008770,
      },
      "linux-x64-musl": {
        binary: "claude.zst",
        checksum: "c70417c61100cd6a490c342249e856621caec5bc3bc83b73fce5bd7bf9d72874",
        size: 53646358,
      },
      "win32-x64": {
        binary: "claude.exe.zst",
        checksum: "e61a1d9fc923a66da34541aec7abf29cd1b5a9dc6cb6e400459021f1acf907ca",
        size: 56045417,
      },
      "win32-arm64": {
        binary: "claude.exe.zst",
        checksum: "bf6fda0f6a6becc044531987ae241ac0cb760773ace6ec43e3a565ea8a024207",
        size: 54140510,
      },
    },
  },
  baseUrl: "https://downloads.claude.ai/claude-code-releases",
} as const;

export type OfficialClaudeCodePlatformId = keyof typeof OFFICIAL_CLAUDE_CODE_RELEASE.manifest.platforms;
