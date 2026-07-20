import path from "node:path";
import { expect, it } from "vitest";
import {
  buildCoworkVmPathContext,
  createCoworkHostLoopOnFolderAddedForBash,
  deriveMountName,
  deriveMountNames,
  deriveMountNamesIncremental,
  deepTranslateVmPaths,
  HOST_LOOP_RESERVED_MOUNT_NAMES,
  mapHostPathToVmPath,
  mapVmPathToHostPath,
  resolveCoworkHostLoopBashMountName,
  translateCoworkMessagePaths,
  translateFileUrisInValue,
} from "./coworkVmPathTranslation";
import type { CoworkSessionRuntimeState } from "./coworkSessionTypes";

const sessionStorageDir = path.join(
  "/tmp",
  "local-agent-mode-sessions",
  "acct",
  "org",
  "local_session_1",
);

const contextBase = {
  sessionStorageDir,
  userSelectedFolders: ["/Users/apple/work-py/AppAgent"],
  vmProcessName: "session_1",
};

it("deriveMountNames disambiguates same basename folders", () => {
  const map = deriveMountNames([
    "/Users/a/project",
    "/Users/b/project",
  ]);
  expect(map.get("/Users/a/project")).toBe("a--project");
  expect(map.get("/Users/b/project")).toBe("b--project");
});

it("deriveMountNamesIncremental seeds reserved names in host-loop", () => {
  const map = deriveMountNamesIncremental(
    ["/Users/apple/outputs"],
    [...HOST_LOOP_RESERVED_MOUNT_NAMES],
  );
  // "outputs" is reserved → disambiguate with parent
  expect(map.get("/Users/apple/outputs")).toBe("apple--outputs");
});

it("deriveMountName walks parent segments when basename is used", () => {
  expect(deriveMountName("/tmp/foo/bar", ["bar"])).toBe("foo--bar");
});

it("resolveCoworkHostLoopBashMountName matches official ?: / || precedence", () => {
  // network drive → undefined (dXe uses kind note; bashMountName not set)
  expect(
    resolveCoworkHostLoopBashMountName({
      hostLoopOnFolderAdded: () => "should-not-run",
      hostPath: "/Volumes/share",
      networkDrive: true,
    }),
  ).toBeUndefined();

  // missing inject → undefined
  expect(
    resolveCoworkHostLoopBashMountName({
      hostPath: "/Users/a/project",
      networkDrive: false,
    }),
  ).toBeUndefined();
  expect(
    resolveCoworkHostLoopBashMountName({
      hostLoopOnFolderAdded: null,
      hostPath: "/Users/a/project",
      networkDrive: false,
    }),
  ).toBeUndefined();

  // inject present → callback result (including empty string from official `_??""`)
  expect(
    resolveCoworkHostLoopBashMountName({
      hostLoopOnFolderAdded: (p) => path.basename(p),
      hostPath: "/Users/a/project",
      networkDrive: false,
    }),
  ).toBe("project");
  expect(
    resolveCoworkHostLoopBashMountName({
      hostLoopOnFolderAdded: () => "",
      hostPath: "/Users/a/project",
      networkDrive: false,
    }),
  ).toBe("");
});

it("createCoworkHostLoopOnFolderAddedForBash uses p_ reserved seeds", () => {
  const folders = ["/Users/apple/work-py/AppAgent"];
  const cb = createCoworkHostLoopOnFolderAddedForBash(() => folders);
  expect(cb("/Users/apple/work-py/AppAgent")).toBe("AppAgent");
  expect(cb("/missing")).toBe("");
  // reserved "outputs" disambiguates
  const reserved = createCoworkHostLoopOnFolderAddedForBash(
    () => ["/Users/apple/outputs"],
  );
  expect(reserved("/Users/apple/outputs")).toBe("apple--outputs");
});

it("maps host folder paths into /sessions/<vm>/mnt/<name>/...", () => {
  const vm = mapHostPathToVmPath(
    "/Users/apple/work-py/AppAgent/src/index.ts",
    contextBase,
  );
  expect(vm).toBe(
    "/sessions/session_1/mnt/AppAgent/src/index.ts",
  );
});

it("maps session outputs/uploads host paths", () => {
  const outputs = mapHostPathToVmPath(
    path.join(sessionStorageDir, "outputs", "report.md"),
    contextBase,
  );
  expect(outputs).toBe("/sessions/session_1/mnt/outputs/report.md");
  const uploads = mapHostPathToVmPath(
    path.join(sessionStorageDir, "uploads", "a.png"),
    contextBase,
  );
  expect(uploads).toBe("/sessions/session_1/mnt/uploads/a.png");
});

it("maps .auto-memory mount via autoMemoryDir (official ZrA/Use/GL host root)", () => {
  const autoMemoryDir = path.join(
    "/tmp",
    "local-agent-mode-sessions",
    "acct",
    "org",
    "spaces",
    "space_1",
    "memory",
  );
  const ctx = { ...contextBase, autoMemoryDir };
  const vm = mapHostPathToVmPath(
    path.join(autoMemoryDir, "MEMORY.md"),
    ctx,
  );
  expect(vm).toBe("/sessions/session_1/mnt/.auto-memory/MEMORY.md");
  expect(
    mapVmPathToHostPath("/sessions/session_1/mnt/.auto-memory/MEMORY.md", ctx),
  ).toBe(path.join(autoMemoryDir, "MEMORY.md"));
  // Without autoMemoryDir the mount is unmappable.
  expect(
    mapVmPathToHostPath(
      "/sessions/session_1/mnt/.auto-memory/MEMORY.md",
      contextBase,
    ),
  ).toBeNull();
});

it("maps VM mnt paths back to host paths", () => {
  expect(
    mapVmPathToHostPath(
      "/sessions/session_1/mnt/AppAgent/src/index.ts",
      contextBase,
    ),
  ).toBe(path.join("/Users/apple/work-py/AppAgent", "src", "index.ts"));
  expect(
    mapVmPathToHostPath(
      "/sessions/session_1/mnt/outputs/report.md",
      contextBase,
    ),
  ).toBe(path.join(sessionStorageDir, "outputs", "report.md"));
});

it("rejects unsafe VM path segments", () => {
  expect(
    mapVmPathToHostPath(
      "/sessions/session_1/mnt/AppAgent/../etc/passwd",
      contextBase,
    ),
  ).toBeNull();
});

it("throws for host paths outside mounts", () => {
  expect(() =>
    mapHostPathToVmPath("/etc/passwd", contextBase),
  ).toThrow(/Path not accessible in VM/);
});

it("deepTranslateVmPaths rewrites bare VM paths in message trees", () => {
  const message = {
    type: "assistant",
    message: {
      content: [
        {
          type: "text",
          text: "Wrote /sessions/session_1/mnt/AppAgent/README.md",
        },
      ],
    },
  };
  const translated = deepTranslateVmPaths(
    message,
    "/sessions/session_1/mnt/",
    contextBase,
  ) as typeof message;
  expect(translated.message.content[0].text).toContain(
    path.join("/Users/apple/work-py/AppAgent", "README.md"),
  );
  expect(translated.message.content[0].text).not.toContain(
    "/sessions/session_1/mnt/",
  );
});

it("deepTranslateVmPaths leaves base64 blobs untouched", () => {
  const blob = { type: "base64", data: "abc", media_type: "image/png" };
  expect(
    deepTranslateVmPaths(blob, "/sessions/session_1/mnt/", contextBase),
  ).toBe(blob);
});

it("translateFileUrisInValue rewrites file:// host→vm", () => {
  const hostFile = pathToFileUrlFor(
    "/Users/apple/work-py/AppAgent/doc.txt",
  );
  const translated = translateFileUrisInValue(
    { path: hostFile },
    contextBase,
    "host-to-vm",
  ) as { path: string };
  expect(translated.path).toMatch(/^file:\/\//);
  expect(translated.path).toContain("sessions");
  expect(translated.path).toContain("AppAgent");
});

it("buildCoworkVmPathContext + translateCoworkMessagePaths integrate", () => {
  const session = {
    hostLoopMode: false,
    resolvedFolders: [
      {
        canonical: "/Users/apple/work-py/AppAgent",
        display: "/Users/apple/work-py/AppAgent",
        kind: "local" as const,
      },
    ],
    vmProcessName: "session_1",
  } satisfies Pick<
    CoworkSessionRuntimeState,
    "hostLoopMode" | "resolvedFolders" | "vmProcessName"
  >;
  const context = buildCoworkVmPathContext(session, {
    sessionStorageDir,
  });
  expect(context?.userSelectedFolders).toEqual([
    "/Users/apple/work-py/AppAgent",
  ]);
  const message = {
    type: "assistant",
    text: "see /sessions/session_1/mnt/outputs/out.txt",
  };
  const out = translateCoworkMessagePaths(message, context, false);
  expect(out.text).toBe(
    `see ${path.join(sessionStorageDir, "outputs", "out.txt")}`,
  );
});

function pathToFileUrlFor(hostPath: string): string {
  // Match Node pathToFileURL for absolute unix paths.
  return `file://${hostPath}`;
}
