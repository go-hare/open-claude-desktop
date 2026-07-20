export const HOST_LOOP_WORKSPACE_TOOLS = [
  "mcp__workspace__bash",
  "mcp__workspace__web_fetch",
] as const;

export const HOST_LOOP_DIRECT_DISALLOWED_TOOLS = [
  "Bash",
  "NotebookEdit",
  "REPL",
  "JavaScript",
  "WebFetch",
] as const;

export const HOST_LOOP_FILE_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"] as const;

export const HOST_LOOP_TOOL_NAMES = [
  "Task",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "WebSearch",
  "Skill",
  "AskUserQuestion",
  "ToolSearch",
  "SendUserMessage",
] as const;

export const OUTSIDE_WORKING_DIRECTORIES_REASON = "Path is outside allowed working directories";

const hostToolNames = new Set<string>(HOST_LOOP_TOOL_NAMES);
const fileToolNames = new Set<string>(HOST_LOOP_FILE_TOOLS);
const removedAllowedTools = new Set<string>([
  ...HOST_LOOP_DIRECT_DISALLOWED_TOOLS,
  ...HOST_LOOP_FILE_TOOLS,
]);

export type CoworkHostRuleBuilder = {
  edit: (path: string) => string;
  /**
   * Official Ohe full allow rule:
   *   Read(Pv(join(configDir,"projects")) with tool-results suffix).
   */
  projectsToolResults: (configDir: string) => string;
  read: (path: string) => string;
  write: (path: string) => string;
};

/**
 * Official app.asar `Pv(e)` — host permission path glob for V1i/HUA/Ohe:
 * strip trailing slashes, win32 drive/UNC normalize, append `/**`.
 * Non-win32 absolute paths yield a leading `//` (faithful to minified `/${A}/**`).
 */
export function normalizeCoworkHostPermissionPath(
  inputPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const stripped = inputPath.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    if (/^[\\/]{2}/.test(inputPath)) {
      return `${stripped.replace(/\\/g, "/")}/**`;
    }
    const drive = stripped.match(/^([A-Za-z]):(?:[/\\]|$)/);
    return `/${
      drive
        ? `/${drive[1].toLowerCase()}${stripped.slice(2).replace(/\\/g, "/")}`
        : stripped.replace(/\\/g, "/")
    }/**`;
  }
  return `/${stripped}/**`;
}

function hostProjectsDir(configDir: string): string {
  const base = configDir.replace(/[\\/]+$/, "");
  return `${base}/projects`;
}

/** Official Ohe inner path after Pv + tool-results replace. */
export function coworkHostOhePermissionPath(
  configDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return normalizeCoworkHostPermissionPath(
    hostProjectsDir(configDir),
    platform,
  ).replace(/\/\*\*$/, "/**/tool-results/**");
}

/** Official V1i path rule strings: Edit(Pv) / Write(Pv) / Read(Pv) / Ohe. */
export const DEFAULT_COWORK_HOST_RULES: CoworkHostRuleBuilder = {
  edit: (targetPath) => `Edit(${normalizeCoworkHostPermissionPath(targetPath)})`,
  projectsToolResults: (configDir) =>
    `Read(${coworkHostOhePermissionPath(configDir)})`,
  read: (targetPath) => `Read(${normalizeCoworkHostPermissionPath(targetPath)})`,
  write: (targetPath) => `Write(${normalizeCoworkHostPermissionPath(targetPath)})`,
};

/**
 * Official UXe/V1i auto-memory host allow rules:
 *   autoMemoryReadOnly (radar) → Read only
 *   else → Edit + Write + Read
 *   missing dir → []
 */
export function coworkAutoMemoryAllowedToolRules(
  autoMemoryDir: string | null | undefined,
  autoMemoryReadOnly = false,
  rules: CoworkHostRuleBuilder = DEFAULT_COWORK_HOST_RULES,
): string[] {
  if (!autoMemoryDir) return [];
  if (autoMemoryReadOnly) return [rules.read(autoMemoryDir)];
  return [
    rules.edit(autoMemoryDir),
    rules.write(autoMemoryDir),
    rules.read(autoMemoryDir),
  ];
}

/**
 * Official HUA(e) — flatMap path → [Edit(Pv(path)), Read(Pv(path))].
 * Used by mountFolderForSession applyFlagSettings allow rules.
 */
export function coworkHUAAllowedToolRules(
  paths: readonly string[],
  rules: CoworkHostRuleBuilder = DEFAULT_COWORK_HOST_RULES,
): string[] {
  return paths.flatMap((targetPath) => [
    rules.edit(targetPath),
    rules.read(targetPath),
  ]);
}

/**
 * Official V1i host path allow rules (subset of rebuild without config/plugins):
 *   HUA([outputs, ...folders]) → Edit+Read each
 *   Read(uploads)
 */
export function coworkSessionMountAllowedToolRules(
  options: {
    folderPermissionPaths?: readonly string[] | null;
    hostOutputsDir?: string | null;
    hostUploadsDir?: string | null;
  },
  rules: CoworkHostRuleBuilder = DEFAULT_COWORK_HOST_RULES,
): string[] {
  const out: string[] = [];
  if (options.hostOutputsDir) {
    out.push(...coworkHUAAllowedToolRules([options.hostOutputsDir], rules));
  }
  for (const folder of options.folderPermissionPaths ?? []) {
    if (!folder) continue;
    out.push(...coworkHUAAllowedToolRules([folder], rules));
  }
  if (options.hostUploadsDir) {
    out.push(rules.read(options.hostUploadsDir));
  }
  return out;
}

/**
 * Official mountFolderForSession host-loop applyFlagSettings payload:
 *   {
 *     permissions: {
 *       additionalDirectories: Q,                 // Q = twe(session) = Zni(resolvedFolders)
 *       allow: HUA([this.getOutputsDir(A), ...Q]),
 *     },
 *   }
 */
export type CoworkHostLoopMountFlagSettings = {
  permissions: {
    additionalDirectories: string[];
    allow: string[];
  };
};

export function coworkHostLoopMountFlagSettings(
  options: {
    folderPermissionPaths: readonly string[];
    hostOutputsDir: string;
  },
  rules: CoworkHostRuleBuilder = DEFAULT_COWORK_HOST_RULES,
): CoworkHostLoopMountFlagSettings {
  const additionalDirectories = [...options.folderPermissionPaths];
  return {
    permissions: {
      additionalDirectories,
      allow: coworkHUAAllowedToolRules(
        [options.hostOutputsDir, ...additionalDirectories],
        rules,
      ),
    },
  };
}

/**
 * Official V1i Ohe + plugin Read rules:
 *   Read(<config>/projects/.../tool-results/...)
 *   optional staged config if different
 *   Read each readOnlyPluginPath
 *
 * Official getClaudeConfigDir = join(sessionStorageDir, ".claude") (+ mkdir 0o700).
 */
export function coworkHostConfigAllowedToolRules(
  options: {
    hostClaudeConfigDir?: string | null;
    readOnlyPluginPaths?: readonly string[] | null;
    stagedClaudeConfigDir?: string | null;
  },
  rules: CoworkHostRuleBuilder = DEFAULT_COWORK_HOST_RULES,
): string[] {
  const out: string[] = [];
  const configDir = options.hostClaudeConfigDir;
  if (configDir) {
    // Official Ohe(r) is already a full Read(...) rule (not Read(Pv(inner)) twice).
    out.push(rules.projectsToolResults(configDir));
    const staged = options.stagedClaudeConfigDir ?? configDir;
    if (staged && staged !== configDir) {
      out.push(rules.projectsToolResults(staged));
    }
  }
  for (const pluginPath of options.readOnlyPluginPaths ?? []) {
    if (!pluginPath) continue;
    out.push(rules.read(pluginPath));
  }
  return out;
}

export type RebuildCoworkHostToolPolicyOptions = {
  allowedTools?: readonly string[];
  autoMemoryDir?: string | null;
  autoMemoryReadOnly?: boolean;
  disallowedTools?: readonly string[];
  folderPermissionPaths: readonly string[];
  hostClaudeConfigDir: string;
  hostOutputsDir: string;
  hostUploadsDir: string;
  readOnlyPluginPaths?: readonly string[];
  rules: CoworkHostRuleBuilder;
  stagedClaudeConfigDir?: string;
};

export type CoworkHostToolPolicy = {
  allowedTools: string[];
  disallowedTools: string[];
};

export type CoworkHostFilePermissionRequest = {
  decisionReason?: string;
  input: unknown;
  toolName: string;
};

export type CoworkHostFileDenial = {
  kind: "outside_working_directories" | "protected_or_outside" | "vm_path";
  path: string;
  toolName: string;
};

export type CoworkHostFileDenyResult = {
  behavior: "deny";
  message: string;
};

export function filterCoworkHostTools(tools: readonly string[]): string[] {
  return tools.filter((toolName) => toolName.startsWith("mcp__") || hostToolNames.has(toolName));
}

export function rebuildCoworkHostToolPolicy(
  options: RebuildCoworkHostToolPolicyOptions,
): CoworkHostToolPolicy {
  const allowedTools = (options.allowedTools ?? []).filter(
    (toolName) => !removedAllowedTools.has(toolName),
  );
  allowedTools.push(...HOST_LOOP_WORKSPACE_TOOLS);
  appendEditReadRules(
    allowedTools,
    [options.hostOutputsDir, ...options.folderPermissionPaths],
    options.rules,
  );
  allowedTools.push(options.rules.read(options.hostUploadsDir));
  appendConfigRules(allowedTools, options);
  appendReadRules(allowedTools, options.readOnlyPluginPaths, options.rules);
  appendMemoryRules(allowedTools, options);
  return {
    allowedTools,
    disallowedTools: [...(options.disallowedTools ?? []), ...HOST_LOOP_DIRECT_DISALLOWED_TOOLS],
  };
}

export function preFilterCoworkHostFilePermission<TResult>(
  request: CoworkHostFilePermissionRequest,
  createResult: (denial: CoworkHostFileDenial) => TResult,
): TResult | undefined {
  const denial = classifyCoworkHostFileDenial(request);
  return denial ? createResult(denial) : undefined;
}

export function classifyCoworkHostFileDenial(
  request: CoworkHostFilePermissionRequest,
): CoworkHostFileDenial | undefined {
  if (!fileToolNames.has(request.toolName)) return undefined;
  const vmPath = findVmPath(request.input);
  if (vmPath) {
    return { kind: "vm_path", path: vmPath, toolName: request.toolName };
  }
  const inputPath = findFirstPath(request.input);
  if (!inputPath) return undefined;
  if (!request.decisionReason) return undefined;
  return {
    kind:
      request.decisionReason === OUTSIDE_WORKING_DIRECTORIES_REASON
        ? "outside_working_directories"
        : "protected_or_outside",
    path: inputPath,
    toolName: request.toolName,
  };
}

export function createCoworkHostFileDenyResult(
  denial: CoworkHostFileDenial,
  requestDirectoryToolName = "request_cowork_directory",
): CoworkHostFileDenyResult {
  if (denial.kind === "vm_path") return vmPathResult(denial);
  if (denial.kind === "outside_working_directories") {
    return outsideDirectoryResult(denial, requestDirectoryToolName);
  }
  return protectedPathResult(denial);
}

function appendEditReadRules(
  target: string[],
  paths: readonly string[],
  rules: CoworkHostRuleBuilder,
): void {
  for (const targetPath of paths) {
    target.push(rules.edit(targetPath), rules.read(targetPath));
  }
}

function appendReadRules(
  target: string[],
  paths: readonly string[] | undefined,
  rules: CoworkHostRuleBuilder,
): void {
  for (const targetPath of paths ?? []) target.push(rules.read(targetPath));
}

function appendConfigRules(target: string[], options: RebuildCoworkHostToolPolicyOptions): void {
  target.push(options.rules.projectsToolResults(options.hostClaudeConfigDir));
  const stagedConfig = options.stagedClaudeConfigDir ?? options.hostClaudeConfigDir;
  if (stagedConfig !== options.hostClaudeConfigDir) {
    target.push(options.rules.projectsToolResults(stagedConfig));
  }
}

function appendMemoryRules(target: string[], options: RebuildCoworkHostToolPolicyOptions): void {
  target.push(
    ...coworkAutoMemoryAllowedToolRules(
      options.autoMemoryDir,
      options.autoMemoryReadOnly,
      options.rules,
    ),
  );
}

function findVmPath(input: unknown): string | undefined {
  const record = inputRecord(input);
  if (!record) return undefined;
  for (const key of ["file_path", "path"] as const) {
    const value = record[key];
    if (typeof value === "string" && isVmPath(value)) return value;
  }
  return undefined;
}

function findFirstPath(input: unknown): string | undefined {
  const record = inputRecord(input);
  if (!record) return undefined;
  for (const key of ["file_path", "path"] as const) {
    if (typeof record[key] === "string") return record[key];
  }
  return undefined;
}

function inputRecord(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object"
    ? (input as Record<string, unknown>)
    : undefined;
}

function isVmPath(inputPath: string): boolean {
  return inputPath === "/sessions" || inputPath.startsWith("/sessions/");
}

function vmPathResult(denial: CoworkHostFileDenial): CoworkHostFileDenyResult {
  return {
    behavior: "deny",
    message: `\`${denial.path}\` is a VM path. In this session the ${denial.toolName} tool runs on the host filesystem, where \`/sessions/...\` doesn't exist. Use the host path for this file (connected folders are available at their real locations), or use the \`bash\` tool — which runs inside the VM — to operate on \`/sessions/...\` paths.`,
  };
}

function outsideDirectoryResult(
  denial: CoworkHostFileDenial,
  requestDirectoryToolName: string,
): CoworkHostFileDenyResult {
  return {
    behavior: "deny",
    message: `\`${denial.path}\` is outside this session's connected folders, so ${denial.toolName} can't reach it. If this is a user project or working folder, request it with the \`${requestDirectoryToolName}\` tool — the user will be asked to approve it. Don't request system or application-internal directories.`,
  };
}

function protectedPathResult(denial: CoworkHostFileDenial): CoworkHostFileDenyResult {
  return {
    behavior: "deny",
    message: `${denial.toolName} on \`${denial.path}\` is blocked in this session — it resolves to a protected location or a path outside the connected folder. Work on a copy under the session outputs folder if you need to modify it.`,
  };
}
