import { expect, it, vi } from "vitest";
import {
  OUTSIDE_WORKING_DIRECTORIES_REASON,
  coworkAutoMemoryAllowedToolRules,
  coworkHUAAllowedToolRules,
  coworkHostConfigAllowedToolRules,
  coworkHostLoopMountFlagSettings,
  coworkHostOhePermissionPath,
  coworkSessionMountAllowedToolRules,
  createCoworkHostFileDenyResult,
  filterCoworkHostTools,
  normalizeCoworkHostPermissionPath,
  preFilterCoworkHostFilePermission,
  rebuildCoworkHostToolPolicy,
  type CoworkHostRuleBuilder,
} from "./coworkHostToolPolicy";

const rules: CoworkHostRuleBuilder = {
  edit: (path) => `Edit(${path})`,
  projectsToolResults: (configDir) =>
    `Read(${configDir}/projects/**/tool-results/**)`,
  read: (path) => `Read(${path})`,
  write: (path) => `Write(${path})`,
};

it("keeps only official host tools and MCP tools", () => {
  expect(
    filterCoworkHostTools([
      "Bash",
      "Read",
      "Task",
      "mcp__custom__tool",
      "JavaScript",
      "Unknown",
      "SendUserMessage",
    ]),
  ).toEqual(["Read", "Task", "mcp__custom__tool", "SendUserMessage"]);
});

it("normalizes official V1i Pv path globs (unix + win32)", () => {
  expect(normalizeCoworkHostPermissionPath("/memory", "darwin")).toBe(
    "//memory/**",
  );
  expect(normalizeCoworkHostPermissionPath("/out/", "linux")).toBe("//out/**");
  expect(normalizeCoworkHostPermissionPath("C:\\work\\proj", "win32")).toBe(
    "//c/work/proj/**",
  );
  expect(normalizeCoworkHostPermissionPath("\\\\server\\share", "win32")).toBe(
    "//server/share/**",
  );
  expect(coworkHostOhePermissionPath("/sess/.claude", "darwin")).toBe(
    "//sess/.claude/projects/**/tool-results/**",
  );
});

it("builds official V1i auto-memory allow rules (rw vs radar read-only)", () => {
  expect(coworkAutoMemoryAllowedToolRules(null)).toEqual([]);
  expect(coworkAutoMemoryAllowedToolRules("/memory")).toEqual([
    "Edit(//memory/**)",
    "Write(//memory/**)",
    "Read(//memory/**)",
  ]);
  expect(coworkAutoMemoryAllowedToolRules("/memory", true)).toEqual([
    "Read(//memory/**)",
  ]);
});

it("builds official V1i outputs/uploads/folder host allow rules", () => {
  expect(
    coworkSessionMountAllowedToolRules({
      folderPermissionPaths: ["/proj"],
      hostOutputsDir: "/out",
      hostUploadsDir: "/up",
    }),
  ).toEqual([
    "Edit(//out/**)",
    "Read(//out/**)",
    "Edit(//proj/**)",
    "Read(//proj/**)",
    "Read(//up/**)",
  ]);
  expect(coworkSessionMountAllowedToolRules({})).toEqual([]);
});

it("builds official HUA Edit+Read rules and mount applyFlagSettings payload", () => {
  expect(coworkHUAAllowedToolRules(["/out", "/proj"], rules)).toEqual([
    "Edit(/out)",
    "Read(/out)",
    "Edit(/proj)",
    "Read(/proj)",
  ]);
  // Default Pv rules (unix): HUA([outputs, ...twe]) for applyFlagSettings.allow.
  expect(
    coworkHostLoopMountFlagSettings({
      folderPermissionPaths: ["/proj", "/share"],
      hostOutputsDir: "/sess/outputs",
    }),
  ).toEqual({
    permissions: {
      additionalDirectories: ["/proj", "/share"],
      allow: [
        "Edit(//sess/outputs/**)",
        "Read(//sess/outputs/**)",
        "Edit(//proj/**)",
        "Read(//proj/**)",
        "Edit(//share/**)",
        "Read(//share/**)",
      ],
    },
  });
  // Injected rule builder preserves raw path tokens (win UNC tested via rules).
  expect(
    coworkHostLoopMountFlagSettings(
      {
        folderPermissionPaths: ["/proj", "\\\\server\\share"],
        hostOutputsDir: "/sess/outputs",
      },
      rules,
    ),
  ).toEqual({
    permissions: {
      additionalDirectories: ["/proj", "\\\\server\\share"],
      allow: [
        "Edit(/sess/outputs)",
        "Read(/sess/outputs)",
        "Edit(/proj)",
        "Read(/proj)",
        "Edit(\\\\server\\share)",
        "Read(\\\\server\\share)",
      ],
    },
  });
  // Official HUA has no Write(...); only Edit+Read pairs.
  expect(
    coworkHUAAllowedToolRules(["/out"]).every(
      (rule) => rule.startsWith("Edit(") || rule.startsWith("Read("),
    ),
  ).toBe(true);
  expect(coworkHUAAllowedToolRules(["/out"]).some((rule) => rule.startsWith("Write("))).toBe(
    false,
  );
});

it("builds official V1i Ohe config + readOnly plugin Read rules", () => {
  expect(
    coworkHostConfigAllowedToolRules({
      hostClaudeConfigDir: "/sess/.claude",
    }),
  ).toEqual(["Read(//sess/.claude/projects/**/tool-results/**)"]);
  expect(
    coworkHostConfigAllowedToolRules({
      hostClaudeConfigDir: "/config",
      readOnlyPluginPaths: ["/plugins/one", ""],
      stagedClaudeConfigDir: "/staged",
    }),
  ).toEqual([
    "Read(//config/projects/**/tool-results/**)",
    "Read(//staged/projects/**/tool-results/**)",
    "Read(//plugins/one/**)",
  ]);
  expect(coworkHostConfigAllowedToolRules({})).toEqual([]);
});

it("rebuilds host-loop allow and deny rules from injected path rules", () => {
  const policy = rebuildCoworkHostToolPolicy({
    allowedTools: ["Bash", "Read(/old/**)", "CustomRule"],
    autoMemoryDir: "/memory",
    disallowedTools: ["ExistingDenied"],
    folderPermissionPaths: ["/projects/one"],
    hostClaudeConfigDir: "/config",
    hostOutputsDir: "/outputs",
    hostUploadsDir: "/uploads",
    readOnlyPluginPaths: ["/plugins/one"],
    rules,
    stagedClaudeConfigDir: "/staged-config",
  });

  expect(policy.allowedTools).toEqual([
    "Read(/old/**)",
    "CustomRule",
    "mcp__workspace__bash",
    "mcp__workspace__web_fetch",
    "Edit(/outputs)",
    "Read(/outputs)",
    "Edit(/projects/one)",
    "Read(/projects/one)",
    "Read(/uploads)",
    "Read(/config/projects/**/tool-results/**)",
    "Read(/staged-config/projects/**/tool-results/**)",
    "Read(/plugins/one)",
    "Edit(/memory)",
    "Write(/memory)",
    "Read(/memory)",
  ]);
  expect(policy.disallowedTools).toEqual([
    "ExistingDenied",
    "Bash",
    "NotebookEdit",
    "REPL",
    "JavaScript",
    "WebFetch",
  ]);
});

it("denies VM paths before any host permission handler", () => {
  const createResult = vi.fn(createCoworkHostFileDenyResult);
  const result = preFilterCoworkHostFilePermission(
    {
      decisionReason: OUTSIDE_WORKING_DIRECTORIES_REASON,
      input: { file_path: "/host/path", path: "/sessions/abc/mnt/project" },
      toolName: "Read",
    },
    createResult,
  );

  expect(createResult).toHaveBeenCalledWith({
    kind: "vm_path",
    path: "/sessions/abc/mnt/project",
    toolName: "Read",
  });
  expect(result).toMatchObject({ behavior: "deny" });
  expect(result?.message).toContain("is a VM path");
});

it("distinguishes outside-working-directory and protected denials", () => {
  const outside = preFilterCoworkHostFilePermission(
    {
      decisionReason: OUTSIDE_WORKING_DIRECTORIES_REASON,
      input: { path: "/outside" },
      toolName: "Write",
    },
    createCoworkHostFileDenyResult,
  );
  const protectedResult = preFilterCoworkHostFilePermission(
    {
      decisionReason: "Protected path",
      input: { file_path: "/System" },
      toolName: "Edit",
    },
    createCoworkHostFileDenyResult,
  );

  expect(outside?.message).toContain("outside this session's connected folders");
  expect(outside?.message).toContain("request_cowork_directory");
  expect(protectedResult?.message).toContain("protected location");
});

it("does not pre-filter non-file tools or inputs without a path", () => {
  expect(
    preFilterCoworkHostFilePermission(
      { input: { path: "/sessions/abc" }, toolName: "Task" },
      createCoworkHostFileDenyResult,
    ),
  ).toBeUndefined();
  expect(
    preFilterCoworkHostFilePermission(
      { input: { pattern: "*.ts" }, toolName: "Grep" },
      createCoworkHostFileDenyResult,
    ),
  ).toBeUndefined();
  expect(
    preFilterCoworkHostFilePermission(
      { input: { path: "/connected/project" }, toolName: "Read" },
      createCoworkHostFileDenyResult,
    ),
  ).toBeUndefined();
});
