import { expect, it, vi } from "vitest";
import {
  OUTSIDE_WORKING_DIRECTORIES_REASON,
  createCoworkHostFileDenyResult,
  filterCoworkHostTools,
  preFilterCoworkHostFilePermission,
  rebuildCoworkHostToolPolicy,
  type CoworkHostRuleBuilder,
} from "./coworkHostToolPolicy";

const rules: CoworkHostRuleBuilder = {
  edit: (path) => `Edit(${path})`,
  projectsToolResults: (configDir) => `${configDir}/projects/**/tool-results/**`,
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
