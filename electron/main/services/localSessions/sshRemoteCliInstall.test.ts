import { expect, it } from "vitest";
import { OFFICIAL_CLAUDE_CODE_RELEASE } from "./officialClaudeCodeRelease";
import {
  mapRemoteUnameToClaudePlatform,
  remoteCcdCliPath,
} from "./sshRemoteCliInstall";

it("mapRemoteUnameToClaudePlatform: JDe residual", () => {
  expect(mapRemoteUnameToClaudePlatform({ unameS: "Linux", unameM: "x86_64", musl: false })).toBe("linux-x64");
  expect(mapRemoteUnameToClaudePlatform({ unameS: "Linux", unameM: "aarch64", musl: true })).toBe("linux-arm64-musl");
  expect(mapRemoteUnameToClaudePlatform({ unameS: "Darwin", unameM: "arm64", musl: false })).toBe("darwin-arm64");
});

it("remoteCcdCliPath: $HOME/.claude/remote/ccd-cli/<VOe>/claude", () => {
  expect(remoteCcdCliPath("/home/u", "linux-x64")).toBe(
    `/home/u/.claude/remote/ccd-cli/${OFFICIAL_CLAUDE_CODE_RELEASE.version}/claude`,
  );
});
