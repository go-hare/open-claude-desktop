import { describe, expect, it } from "vitest";
import { collectCcdSdkPlugins } from "./codeCcdPluginsResidual";

describe("collectCcdSdkPlugins (official setupMcpAndPlugins plugin half)", () => {
  it("puts CUi skills plugin first then enabled local installPaths", async () => {
    const plugins = await collectCcdSdkPlugins({
      cwd: "/tmp/proj",
      getSkillsPluginPath: async () => "/tmp/userData/skills-plugin/org/acct",
      getEnabledLocalPlugins: () => [
        { installPath: "/tmp/.claude/plugins/demo", name: "demo" },
      ],
      remotePluginPaths: [],
    });
    expect(plugins).toEqual([
      { type: "local", path: "/tmp/userData/skills-plugin/org/acct" },
      { type: "local", path: "/tmp/.claude/plugins/demo" },
    ]);
  });

  it("skips local plugin when remote has the same name", async () => {
    const plugins = await collectCcdSdkPlugins({
      getSkillsPluginPath: async () => null,
      getEnabledLocalPlugins: () => [
        { installPath: "/tmp/local/dup", name: "dup" },
        { installPath: "/tmp/local/only", name: "only" },
      ],
      remotePluginPaths: [{ installPath: "/tmp/remote/dup", name: "dup" }],
    });
    expect(plugins).toEqual([
      { type: "local", path: "/tmp/remote/dup" },
      { type: "local", path: "/tmp/local/only" },
    ]);
  });

  it("omits plugins option payload when nothing is on disk", async () => {
    const plugins = await collectCcdSdkPlugins({
      getSkillsPluginPath: async () => null,
      getEnabledLocalPlugins: () => [],
    });
    expect(plugins).toEqual([]);
  });
});
