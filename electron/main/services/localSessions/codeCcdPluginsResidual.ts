/**
 * Official CCD setupMcpAndPlugins plugin half (app.asar LocalSessionManager):
 *
 *   const [mcp, localPlugins, skillsPath, remote] = await Promise.all([
 *     coordinator.createAllServers(...),
 *     $u.getEnabledLocalPluginsWithResolver(DkA(cwd), cwd),
 *     yI.waitForFirstSync().then(() => yI.getPluginPath()),
 *     this.getRemotePluginPathsForHost(),
 *   ])
 *   // duplicate name: remote wins, local skipped
 *   a && C.push({ type:"local", path:a })
 *   for (B of remote) C.push({ type:"local", path:B.installPath })
 *   for (B of local) C.push({ type:"local", path:B.installPath })
 *   C.length>0 && (A.plugins = C)
 *
 * Product: CUi getPluginPath + CLI enabled local plugins. Remote fusion list
 * stays empty while eQ / gQ fetch is compiled off — do not invent rpm rows.
 */
import { getSkillsPluginPath } from "./localAgentAssets";
import { listEnabledCliLocalPlugins } from "../plugins/cliLocalPluginsResolver";

export type CcdSdkPlugin = { type: "local"; path: string };

export type CollectCcdSdkPluginsInput = {
  cwd?: string | null;
  /** Injectable CUi getPluginPath (tests). */
  getSkillsPluginPath?: () => Promise<string | null>;
  /** Injectable enabled CLI plugins (tests). */
  getEnabledLocalPlugins?: (
    cwd?: string | null,
  ) => Array<{ installPath: string; name?: string }>;
  /**
   * Official remote plugin paths for host. Product: omit / empty unless caller
   * injects on-disk remote installs — no cloud fetch.
   */
  remotePluginPaths?: Array<{ installPath: string; name?: string }>;
};

export async function collectCcdSdkPlugins(
  input: CollectCcdSdkPluginsInput = {},
): Promise<CcdSdkPlugin[]> {
  const cwd = input.cwd ?? null;
  const [skillsPath, local] = await Promise.all([
    (input.getSkillsPluginPath ?? getSkillsPluginPath)().catch(() => null),
    Promise.resolve(
      (input.getEnabledLocalPlugins ?? ((folder) => listEnabledCliLocalPlugins(folder)))(
        cwd,
      ),
    ).catch(() => [] as Array<{ installPath: string; name?: string }>),
  ]);
  const remote = input.remotePluginPaths ?? [];
  const remoteNames = new Set(
    remote.map((row) => row.name).filter((name): name is string => Boolean(name)),
  );
  const plugins: CcdSdkPlugin[] = [];
  if (skillsPath) plugins.push({ type: "local", path: skillsPath });
  for (const row of remote) {
    if (row.installPath) plugins.push({ type: "local", path: row.installPath });
  }
  for (const row of local) {
    if (!row.installPath) continue;
    if (row.name && remoteNames.has(row.name)) continue;
    plugins.push({ type: "local", path: row.installPath });
  }
  return plugins;
}
