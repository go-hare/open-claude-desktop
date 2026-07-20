/**
 * Official app.asar DUi path-translation module (gh/qHA/XL/DeA/Ym/KHA/p_).
 *
 * Exports used by LocalAgentModeSessionManager:
 *   mapVMPathToHostPath (gh)
 *   mapHostPathToVMPath (qHA)
 *   deepTranslateVMPaths (XL)
 *   translateFileUrisInValue (DeA)
 *   deriveMountNames (Ym) / deriveMountNamesIncremental (p_)
 *   HOST_LOOP_RESERVED_MOUNT_NAMES (Eq)
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CoworkResolvedFolder,
  CoworkSessionRuntimeState,
} from "./coworkSessionTypes";

/** Official BMA join for disambiguated mount basenames. */
const MOUNT_NAME_JOIN = "--";

/** Official vL / eKe / qni reserved under /sessions/<vm>/mnt/. */
export const COWORK_AUTO_MEMORY_MOUNT = ".auto-memory";
export const COWORK_REMOTE_PLUGINS_MOUNT = ".remote-plugins";
export const COWORK_LOCAL_PLUGINS_MOUNT = ".local-plugins";

/** Official Eq — HOST_LOOP_RESERVED_MOUNT_NAMES. */
export const HOST_LOOP_RESERVED_MOUNT_NAMES = Object.freeze([
  "outputs",
  "uploads",
  ".host-home",
  COWORK_AUTO_MEMORY_MOUNT,
  COWORK_REMOTE_PLUGINS_MOUNT,
  COWORK_LOCAL_PLUGINS_MOUNT,
  ".projects",
]);

export type CoworkVmPathContext = {
  autoMemoryDir?: string | null;
  mountNameMap?: Map<string, string>;
  sessionStorageDir?: string | null;
  userSelectedFolders?: string[];
  vmProcessName: string;
};

export type CoworkUriTranslateDirection = "host-to-vm" | "vm-to-host";

/** Official Lc — host path identity for a resolved folder. */
export function resolvedFolderHostPath(folder: CoworkResolvedFolder): string {
  return folder.kind === "local"
    ? (folder.canonical ?? folder.display)
    : folder.display;
}

/** Official _c — all folder host paths. */
export function listResolvedFolderHostPaths(
  folders: CoworkResolvedFolder[] | undefined,
): string[] {
  return (folders ?? []).map(resolvedFolderHostPath);
}

/** Official NH — non-local folder path set (excluded from userSelectedFolders mounts). */
export function nonLocalFolderHostPaths(
  folders: CoworkResolvedFolder[] | undefined,
): Set<string> {
  return new Set(
    (folders ?? [])
      .filter((folder) => folder.kind !== "local")
      .map(resolvedFolderHostPath),
  );
}

/** Official Ym — unique basename mount map for host-loop=false. */
export function deriveMountNames(folders: string[]): Map<string, string> {
  if (folders.length === 0) return new Map();
  const names = new Map<string, string>();
  const reversedParts = new Map<string, string[]>();
  for (const folder of folders) {
    const parts = folder.split(path.sep).filter((part) => part.length > 0);
    reversedParts.set(folder, parts.reverse());
    names.set(folder, path.basename(folder));
  }
  let budget = 20;
  while (budget-- > 0) {
    const byName = new Map<string, string[]>();
    for (const [folder, name] of names) {
      const group = byName.get(name);
      if (group) group.push(folder);
      else byName.set(name, [folder]);
    }
    let changed = false;
    for (const [, group] of byName) {
      if (group.length <= 1) continue;
      changed = true;
      for (const folder of group) {
        const parts = reversedParts.get(folder)!;
        const current = names.get(folder)!;
        const depth = current.split(MOUNT_NAME_JOIN).length;
        if (depth < parts.length) {
          names.set(folder, `${parts[depth]}${MOUNT_NAME_JOIN}${current}`);
        }
      }
    }
    if (!changed) break;
  }
  return names;
}

/** Official KHA — next unique mount name given already-used names. */
export function deriveMountName(
  folder: string,
  usedNames: Iterable<string>,
): string {
  const used = new Set(usedNames);
  const parts = folder
    .split(path.sep)
    .filter((part) => part.length > 0)
    .reverse();
  let name = parts[0] ?? path.basename(folder);
  let depth = 1;
  while (used.has(name) && depth < parts.length) {
    name = `${parts[depth]}${MOUNT_NAME_JOIN}${name}`;
    depth += 1;
  }
  return name;
}

/** Official p_ — incremental mount names (host-loop uses reserved seeds). */
export function deriveMountNamesIncremental(
  folders: string[],
  reserved: string[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  const used = [...reserved];
  for (const folder of folders) {
    const name = deriveMountName(folder, used);
    used.push(name);
    map.set(folder, name);
  }
  return map;
}

/**
 * Official Cy + Zn — normalize mount path segment for `/sessions/.../mnt/${Zn(name)}`.
 *   Cy: backslash → slash; normalize; strip leading `/`.
 */
export function normalizeCoworkVmMountPathSegment(name: string): string {
  let value = path.posix.normalize(name.split("\\").join("/"));
  if (value.startsWith("/")) value = value.slice(1);
  return value;
}

/**
 * Official mountFolderForSession host-loop bashMountName (app.asar):
 *   const u = n || (C = i.hostLoopOnFolderAdded) == null ? void 0 : C.call(i, r)
 *
 * JS precedence: `||` binds tighter than `?:`, so this is:
 *   u = (n || hostLoopOnFolderAdded == null) ? void 0 : hostLoopOnFolderAdded(r)
 *
 * where n = (pathKind.kind !== "local") and r = host display path.
 *
 * - Network drive → undefined (dXe network note uses kind !== local, not bashMountName).
 * - Callback missing/null → undefined (honest dual-exec UXe residual).
 * - Callback present → its return value (string; may be "" from official `_??""`).
 */
export function resolveCoworkHostLoopBashMountName(options: {
  hostLoopOnFolderAdded?:
    | ((hostPath: string) => string | undefined | null | void)
    | null;
  hostPath: string;
  networkDrive: boolean;
}): string | undefined {
  if (options.networkDrive || options.hostLoopOnFolderAdded == null) {
    return undefined;
  }
  const name = options.hostLoopOnFolderAdded(options.hostPath);
  if (name == null) return undefined;
  return String(name);
}

/**
 * Official UXe `onFolderAddedForBash` residual (host-loop dual-exec only):
 *   Y => { const { nameByFolder } = j(); const _ = nameByFolder.get(Y); return _ ?? "" }
 * Product has no UXe; tests / future dual-exec can inject this onto session.
 * Uses official p_ incremental map with Eq reserved seeds by default.
 */
export function createCoworkHostLoopOnFolderAddedForBash(
  getHostFolders: () => readonly string[],
  reserved: readonly string[] = HOST_LOOP_RESERVED_MOUNT_NAMES,
): (hostPath: string) => string {
  return (hostPath: string) => {
    const nameByFolder = deriveMountNamesIncremental(
      [...getHostFolders()],
      [...reserved],
    );
    return nameByFolder.get(hostPath) ?? "";
  };
}

function mountNameMapForContext(
  context: CoworkVmPathContext,
): Map<string, string> {
  if (context.mountNameMap) return context.mountNameMap;
  return deriveMountNames(context.userSelectedFolders ?? []);
}

function reverseMountNameMap(
  context: CoworkVmPathContext,
): Map<string, string> {
  const forward = mountNameMapForContext(context);
  const reverse = new Map<string, string>();
  for (const [host, mount] of forward) reverse.set(mount, host);
  return reverse;
}

function toPosixRelative(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isPathSegmentUnsafe(segment: string): boolean {
  return segment === ".." || segment === "." || segment === "";
}

function hasUnsafePathSegments(value: string): boolean {
  return value ? value.split(/[/\\]/).some(isPathSegmentUnsafe) : false;
}

/** Official ZUA — map VM `.host-home` relative to host home path. */
export function hostHomeFromVmRelative(relative: string): string {
  if (process.platform === "win32") {
    const slash = relative.indexOf("/");
    const drive = slash === -1 ? relative : relative.slice(0, slash);
    const rest = slash === -1 ? "" : relative.slice(slash + 1);
    if (/^[a-z]$/i.test(drive)) {
      return path.win32.join(`${drive.toUpperCase()}:\\`, rest);
    }
    return path.win32.join("\\", relative);
  }
  return path.posix.join("/", relative);
}

/**
 * Official gh / mapVMPathToHostPath.
 * Returns null when the VM path is outside mnt or unmappable.
 */
export function mapVmPathToHostPath(
  vmPath: string,
  context: CoworkVmPathContext,
): string | null {
  const prefix = `/sessions/${context.vmProcessName}/`;
  if (!vmPath.startsWith(prefix)) return null;
  const rest = vmPath.slice(prefix.length);
  if (hasUnsafePathSegments(rest)) return null;
  if (!rest.startsWith("mnt/")) return null;

  const afterMnt = rest.slice(4);
  const slash = afterMnt.indexOf("/");
  const rawMount = slash === -1 ? afterMnt : afterMnt.slice(0, slash);
  const rawRel = slash === -1 ? "" : afterMnt.slice(slash + 1);
  let mountName: string;
  let relative: string;
  try {
    mountName = decodeURIComponent(rawMount);
  } catch {
    mountName = rawMount;
  }
  try {
    relative = decodeURIComponent(rawRel);
  } catch {
    relative = rawRel;
  }
  if (hasUnsafePathSegments(mountName) || hasUnsafePathSegments(relative)) {
    return null;
  }

  const storage = context.sessionStorageDir ?? null;
  if (mountName === "outputs") {
    return storage ? path.join(storage, "outputs", relative) : null;
  }
  if (mountName === "uploads") {
    return storage ? path.join(storage, "uploads", relative) : null;
  }
  if (mountName === ".host-home") {
    return relative ? hostHomeFromVmRelative(relative) : null;
  }
  if (mountName === COWORK_AUTO_MEMORY_MOUNT) {
    return context.autoMemoryDir
      ? path.join(context.autoMemoryDir, relative)
      : null;
  }
  const hostRoot = reverseMountNameMap(context).get(mountName);
  return hostRoot ? path.join(hostRoot, relative) : null;
}

/**
 * Official qHA / mapHostPathToVMPath.
 * Throws when the host path is not under a known mount.
 */
export function mapHostPathToVmPath(
  hostPath: string,
  context: CoworkVmPathContext,
): string {
  const { vmProcessName, sessionStorageDir, userSelectedFolders } = context;
  const sessionRoot = `/sessions/${vmProcessName}`;
  if (sessionStorageDir) {
    const outputs = path.join(sessionStorageDir, "outputs");
    if (hostPath === outputs || hostPath.startsWith(outputs + path.sep)) {
      return path.posix.join(
        sessionRoot,
        "mnt",
        "outputs",
        toPosixRelative(path.relative(outputs, hostPath)),
      );
    }
    const uploads = path.join(sessionStorageDir, "uploads");
    if (hostPath === uploads || hostPath.startsWith(uploads + path.sep)) {
      return path.posix.join(
        sessionRoot,
        "mnt",
        "uploads",
        toPosixRelative(path.relative(uploads, hostPath)),
      );
    }
  }
  if (context.autoMemoryDir) {
    const memory = context.autoMemoryDir;
    if (hostPath === memory || hostPath.startsWith(memory + path.sep)) {
      return path.posix.join(
        sessionRoot,
        "mnt",
        COWORK_AUTO_MEMORY_MOUNT,
        toPosixRelative(path.relative(memory, hostPath)),
      );
    }
  }
  const mounts = mountNameMapForContext(context);
  for (const folder of userSelectedFolders ?? []) {
    if (hostPath === folder || hostPath.startsWith(folder + path.sep)) {
      const mount = mounts.get(folder) ?? path.basename(folder);
      return path.posix.join(
        sessionRoot,
        "mnt",
        mount,
        toPosixRelative(path.relative(folder, hostPath)),
      );
    }
  }
  throw new Error(`Path not accessible in VM: ${hostPath}`);
}

function encodeComputerUrlPath(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function encodeComputerUrlSegments(value: string): string {
  return value.split("/").map(encodeComputerUrlPath).join("/");
}

function reencodeComputerUrlSegments(value: string): string {
  return value
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* keep */
      }
      return encodeComputerUrlPath(decoded);
    })
    .join("/");
}

const COMPUTER_URL_STOP = new Set(['"', "`", "]", "\\"]);

function scanComputerUrlEnd(
  text: string,
  from: number,
  stop: Set<string> | null,
): number {
  let depth = 0;
  let openParen = -1;
  for (let i = from; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "(") {
      if (depth === 0) openParen = i;
      depth += 1;
    } else if (ch === ")") {
      if (depth === 0) return i;
      depth -= 1;
      if (depth === 0) openParen = -1;
    } else if (
      depth === 0 &&
      stop !== null &&
      (stop.has(ch) || /\s/.test(ch))
    ) {
      return i;
    }
  }
  return depth > 0 ? openParen : text.length;
}

function replaceComputerUrlPrefixes(
  text: string,
  needle: string,
  replacement: string,
  stop: Set<string> | null,
  requireClosingParen: boolean,
  mapTail: (tail: string) => string | null,
): string {
  let out = "";
  let cursor = 0;
  let found = text.indexOf(needle, cursor);
  while (found !== -1) {
    out += text.slice(cursor, found);
    const tailStart = found + needle.length;
    const end = scanComputerUrlEnd(text, tailStart, stop);
    if (requireClosingParen && text.charAt(end) !== ")") {
      out += needle;
      cursor = tailStart;
    } else {
      const closer = requireClosingParen ? ")" : "";
      const tail = text.slice(tailStart, end);
      const mapped = mapTail(tail);
      if (mapped === null) out += needle + tail + closer;
      else out += replacement + mapped + closer;
      cursor = end + closer.length;
    }
    found = text.indexOf(needle, cursor);
  }
  return out + text.slice(cursor);
}

/**
 * Official $ze — encode computer:// URL path segments for host-loop display.
 */
export function encodeComputerUrlsForHostLoop(text: string): string {
  if (!text.includes("computer://")) return text;
  const pattern =
    /(`computer:\/\/[^`]+`)|(\]\(computer:\/\/)|(computer:\/\/)/g;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [full, code, markdown, bare] = match;
    out += text.slice(cursor, match.index);
    if (code !== undefined) {
      out += code;
      cursor = match.index + full.length;
    } else if (markdown !== undefined) {
      const start = match.index + full.length;
      const end = scanComputerUrlEnd(text, start, null);
      if (text.charAt(end) === ")") {
        const body = text.slice(start, end);
        out += markdown + reencodeComputerUrlSegments(body) + ")";
        cursor = end + 1;
      } else {
        out += markdown;
        cursor = start;
      }
    } else if (bare !== undefined) {
      const start = match.index + full.length;
      const end = scanComputerUrlEnd(text, start, COMPUTER_URL_STOP);
      const body = text.slice(start, end);
      out += bare + reencodeComputerUrlSegments(body);
      cursor = end;
    } else {
      out += full;
      cursor = match.index + full.length;
    }
    pattern.lastIndex = cursor;
  }
  return out + text.slice(cursor);
}

/**
 * Official uMA — translate file:// URIs host↔vm.
 */
export function translateFileUri(
  uri: string,
  context: CoworkVmPathContext,
  direction: CoworkUriTranslateDirection,
): string {
  if (!uri.startsWith("file://")) return uri;
  const after = uri.slice(7);
  if (!after.startsWith("/")) return uri;
  if (direction === "vm-to-host") {
    const host = mapVmPathToHostPath(after, context);
    return host === null ? uri : pathToFileURL(host).href;
  }
  let hostPath: string;
  try {
    hostPath = fileURLToPath(uri);
  } catch {
    return uri;
  }
  try {
    return `file://${mapHostPathToVmPath(hostPath, context)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  } catch {
    return uri;
  }
}

/** Official DeA / translateFileUrisInValue. */
export function translateFileUrisInValue(
  value: unknown,
  context: CoworkVmPathContext,
  direction: CoworkUriTranslateDirection,
): unknown {
  if (typeof value === "string") {
    return value.startsWith("file://")
      ? translateFileUri(value, context, direction)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      translateFileUrisInValue(item, context, direction),
    );
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = translateFileUrisInValue(nested, context, direction);
    }
    return out;
  }
  return value;
}

/**
 * Official pUi — string-level VM→host translation for paths under
 * `/sessions/<vm>/mnt/`.
 */
function translateVmPathsInString(
  text: string,
  mntPrefix: string,
  context: CoworkVmPathContext,
): string {
  if (!text.includes(mntPrefix)) return text;
  let working = text;
  if (working.includes("file://")) {
    if (working.startsWith("file://") && !/\s/.test(working)) {
      return translateFileUri(working, context, "vm-to-host");
    }
    working = working.replace(
      /file:\/\/\/[^\s)"'`\]\\#?]+/g,
      (match) => translateFileUri(match, context, "vm-to-host"),
    );
    if (!working.includes(mntPrefix)) return working;
  }

  const escaped = mntPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (working.startsWith(mntPrefix) && !working.includes("\n")) {
    const leaf = working.split("/").pop() ?? "";
    if (!/\.\w+\s/.test(leaf)) {
      const host = mapVmPathToHostPath(working, context);
      if (host) return host;
    }
  }

  working = replaceComputerUrlPrefixes(
    working,
    `](computer://${mntPrefix}`,
    "](computer://",
    null,
    true,
    (tail) => {
      const host = mapVmPathToHostPath(mntPrefix + tail, context);
      return host ? encodeComputerUrlSegments(host) : null;
    },
  );
  working = working.replace(
    new RegExp(`\`computer://(${escaped}[^\`]+)\``, "g"),
    (_full, vmPath: string) => {
      const host = mapVmPathToHostPath(vmPath, context);
      return host
        ? `\`computer://${host}\``
        : `\`computer://${vmPath}\``;
    },
  );
  working = replaceComputerUrlPrefixes(
    working,
    `computer://${mntPrefix}`,
    "computer://",
    COMPUTER_URL_STOP,
    false,
    (tail) => {
      const host = mapVmPathToHostPath(mntPrefix + tail, context);
      return host ? encodeComputerUrlSegments(host) : null;
    },
  );
  working = working.replace(
    new RegExp(`(?<![a-zA-Z0-9])(${escaped}[^\\s)"\`\\]\\\\]+)`, "g"),
    (_full, vmPath: string) => mapVmPathToHostPath(vmPath, context) ?? vmPath,
  );
  return working;
}

/**
 * Official XL / deepTranslateVMPaths.
 * Walks message trees and rewrites VM mnt paths to host paths.
 * When encodeComputerUrls is true (hostLoopMode), computer:// segments are
 * re-encoded first ($ze).
 */
export function deepTranslateVmPaths(
  value: unknown,
  mntPrefix: string,
  context: CoworkVmPathContext,
  encodeComputerUrls = false,
): unknown {
  if (typeof value === "string") {
    const prepared = encodeComputerUrls
      ? encodeComputerUrlsForHostLoop(value)
      : value;
    return translateVmPathsInString(prepared, mntPrefix, context);
  }
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const next = deepTranslateVmPaths(
        value[i],
        mntPrefix,
        context,
        encodeComputerUrls,
      );
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Official: leave base64 image blobs untouched.
    if (record.type === "base64" && typeof record.data === "string") {
      return value;
    }
    let copy: Record<string, unknown> | undefined;
    for (const [key, nested] of Object.entries(record)) {
      const next = deepTranslateVmPaths(
        nested,
        mntPrefix,
        context,
        encodeComputerUrls,
      );
      if (next !== nested) {
        copy ??= { ...record };
        copy[key] = next;
      }
    }
    return copy ?? value;
  }
  return value;
}

/**
 * Official translateMessagePaths / buildVMPathContext subset for a session.
 */
export function buildCoworkVmPathContext(
  session: Pick<
    CoworkSessionRuntimeState,
    "hostLoopMode" | "resolvedFolders" | "vmProcessName"
  >,
  options: {
    autoMemoryDir?: string | null;
    sessionStorageDir?: string | null;
  },
): CoworkVmPathContext | null {
  const vmProcessName = session.vmProcessName;
  if (!vmProcessName) return null;
  const allFolders = listResolvedFolderHostPaths(session.resolvedFolders);
  const nonLocal = nonLocalFolderHostPaths(session.resolvedFolders);
  const localFolders = allFolders.filter((folder) => !nonLocal.has(folder));
  const rawMounts = session.hostLoopMode
    ? deriveMountNamesIncremental(allFolders, [...HOST_LOOP_RESERVED_MOUNT_NAMES])
    : deriveMountNames(allFolders);
  const mountNameMap = new Map(
    [...rawMounts].filter(([folder]) => !nonLocal.has(folder)),
  );
  return {
    autoMemoryDir: options.autoMemoryDir ?? null,
    mountNameMap,
    sessionStorageDir: options.sessionStorageDir ?? null,
    userSelectedFolders: localFolders,
    vmProcessName,
  };
}

/** Official LocalAgentModeSessionManager.translateMessagePaths. */
export function translateCoworkMessagePaths<T>(
  message: T,
  context: CoworkVmPathContext | null,
  hostLoopMode?: boolean,
): T {
  if (!context) return message;
  const mntPrefix = `/sessions/${context.vmProcessName}/mnt/`;
  return deepTranslateVmPaths(
    message,
    mntPrefix,
    context,
    Boolean(hostLoopMode),
  ) as T;
}
