import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  computeNextRunAt,
  getJitterSecondsForTask,
} from "./scheduledTaskJitter";

/**
 * Residual surface:
 * - CCDScheduledTasks → Code / `/code/scheduled` (ST bridge)
 * - CoworkScheduledTasks → Cowork / `/scheduled-task` (jT bridge)
 * Same on-disk file, filtered by `channel` so the two UIs stay separate.
 */
export type ScheduledTaskChannel = "code" | "cowork";

export type ScheduledTask = {
  id: string;
  name?: string;
  title: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  cronExpression?: string;
  cronHumanReadable?: string;
  cwd?: string;
  fireAt?: string;
  lastRunAt?: string;
  model?: string;
  nextRunAt?: string;
  /**
   * Official uYt disableJitter ("Run at exact time") — persisted; list enriches jitterSeconds=0.
   */
  disableJitter?: boolean;
  /**
   * Official list enrichment via getJitterSecondsForTask (not persisted; recomputed on read).
   */
  jitterSeconds?: number;
  permissionMode?: string;
  sourceBranch?: string;
  useWorktree?: boolean;
  userSelectedFolders?: string[];
  /** Residual space_page Qa: task linked to cowork space (empty string unlinks). */
  spaceId?: string;
  /**
   * Which product surface owns this task.
   * Missing on legacy rows → inferred: spaceId present ⇒ cowork, else code.
   */
  channel?: ScheduledTaskChannel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  approvedPermissions?: Array<{ toolName: string }>;
  /** Residual jT chrome always-allow (clearChromePermissions). */
  chromeAllowedDomains?: string[];
  chromePermissionMode?: string;
};

export function resolveScheduledTaskChannel(task: Pick<ScheduledTask, "channel" | "spaceId">): ScheduledTaskChannel {
  if (task.channel === "cowork" || task.channel === "code") return task.channel;
  // Legacy rows: project-linked tasks belong to cowork residual; bare rows default to code for run path.
  if (task.spaceId && task.spaceId.length > 0) return "cowork";
  return "code";
}

/** List membership: tagged rows stay on their channel; untagged legacy rows appear on both until edited. */
export function scheduledTaskVisibleOnChannel(
  task: Pick<ScheduledTask, "channel" | "spaceId">,
  channel: ScheduledTaskChannel,
): boolean {
  if (task.channel === "cowork" || task.channel === "code") return task.channel === channel;
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cronHumanReadable(cronExpression?: string): string | undefined {
  if (!cronExpression) return undefined;
  const [minute, hour, , , day] = cronExpression.split(" ");
  if (!minute || !hour) return cronExpression;
  if (hour === "*") return "Hourly";
  if (day === "1-5") return `Weekdays at ${formatTime(Number(hour), Number(minute))}`;
  if (day && day !== "*") return `Weekly on ${DAYS[Number(day)] ?? "Monday"} at ${formatTime(Number(hour), Number(minute))}`;
  return `Daily at ${formatTime(Number(hour), Number(minute))}`;
}

/**
 * Residual list enrichment: jitterSeconds + zDA nextRunAt (fireAt or cron+jitter).
 * Persist path keeps raw task without computed jitterSeconds.
 */
function enrichScheduledTask(task: ScheduledTask): ScheduledTask {
  const jitterSeconds = getJitterSecondsForTask(task);
  const nextRunAt = computeNextRunAt(task, jitterSeconds * 1000);
  return {
    ...task,
    jitterSeconds,
    nextRunAt: nextRunAt ?? task.nextRunAt,
  };
}

export class ScheduledTaskStore {
  private tasks = new Map<string, ScheduledTask>();
  private files = new Map<string, string>();
  private readonly filePath: string;

  constructor(filePath = path.join(app.getPath("userData"), "scheduled-tasks.json")) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const files = typeof parsed.files === "object" && parsed.files !== null ? parsed.files : {};
      this.tasks = new Map(tasks.map((task: ScheduledTask) => [task.id, task]));
      this.files = new Map(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch {
      this.tasks = new Map();
      this.files = new Map();
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({
      tasks: Array.from(this.tasks.values()),
      files: Object.fromEntries(this.files),
    }, null, 2));
  }

  getAllScheduledTasks(channel?: ScheduledTaskChannel): ScheduledTask[] {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const scoped = channel
      ? all.filter((task) => scheduledTaskVisibleOnChannel(task, channel))
      : all;
    return scoped.map(enrichScheduledTask);
  }

  getScheduledTask(id: string, channel?: ScheduledTaskChannel): ScheduledTask | null {
    const task = this.tasks.get(id) ?? null;
    if (!task) return null;
    if (channel && !scheduledTaskVisibleOnChannel(task, channel)) return null;
    return enrichScheduledTask(task);
  }

  createScheduledTask(input: Partial<ScheduledTask> & { name?: string; title?: string }): ScheduledTask {
    const timestamp = nowIso();
    const title = input.title ?? input.name ?? "Scheduled task";
    // Residual: create may omit cron (once=manual) or set fireAt (remote/edit seed); do not invent fireAt for once.
    const cronExpression = input.cronExpression || undefined;
    const fireAt = typeof input.fireAt === "string" && input.fireAt.length > 0 ? input.fireAt : undefined;
    const spaceId = input.spaceId && input.spaceId.length > 0 ? input.spaceId : undefined;
    const channel: ScheduledTaskChannel =
      input.channel === "cowork" || input.channel === "code"
        ? input.channel
        : spaceId
          ? "cowork"
          : "code";
    const task: ScheduledTask = {
      id: input.id ?? (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `task_${Date.now()}`),
      name: input.name ?? title,
      title,
      description: input.description,
      prompt: input.prompt,
      schedule: input.schedule ?? cronHumanReadable(cronExpression) ?? (fireAt ? "Run once" : cronExpression ?? "Manual"),
      cronExpression,
      cronHumanReadable: cronHumanReadable(cronExpression),
      cwd: input.cwd,
      fireAt,
      model: input.model,
      disableJitter: input.disableJitter === true ? true : undefined,
      permissionMode: input.permissionMode,
      sourceBranch: input.sourceBranch,
      useWorktree: input.useWorktree,
      userSelectedFolders: input.userSelectedFolders,
      spaceId,
      channel,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
      approvedPermissions: input.approvedPermissions ?? [],
      // Residual jT chrome always-allow fields (clearChromePermissions).
      chromePermissionMode: input.chromePermissionMode,
      chromeAllowedDomains: input.chromeAllowedDomains,
    };
    // Persist without computed jitterSeconds; enrich on return (official list shape).
    this.tasks.set(task.id, task);
    // Residual pYt reads getScheduledTaskFileContent on fire — seed file body from create prompt.
    if (typeof input.prompt === "string") {
      this.files.set(task.id, input.prompt);
    }
    this.save();
    return enrichScheduledTask(task);
  }

  updateScheduledTask(id: string, input: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    // Residual update may clear cron via null-ish; fireAt may be set/cleared.
    const cronExpression =
      input.cronExpression === null
        ? undefined
        : input.cronExpression !== undefined
          ? input.cronExpression || undefined
          : task.cronExpression;
    const fireAt =
      input.fireAt === null
        ? undefined
        : input.fireAt !== undefined
          ? input.fireAt || undefined
          : task.fireAt;
    // Residual Qa unlink passes spaceId: "" — store as undefined (no space).
    const spaceId =
      input.spaceId === undefined
        ? task.spaceId
        : input.spaceId && input.spaceId.length > 0
          ? input.spaceId
          : undefined;
    const channel: ScheduledTaskChannel =
      input.channel === "cowork" || input.channel === "code"
        ? input.channel
        : resolveScheduledTaskChannel({ channel: task.channel, spaceId });
    const disableJitter =
      input.disableJitter === undefined
        ? task.disableJitter
        : input.disableJitter === true
          ? true
          : undefined;
    const { jitterSeconds: _dropJitter, nextRunAt: _dropNext, ...inputRest } = input as ScheduledTask & {
      cronExpression?: string | null;
      fireAt?: string | null;
    };
    const updated: ScheduledTask = {
      ...task,
      ...inputRest,
      id,
      spaceId,
      channel,
      fireAt,
      disableJitter,
      schedule:
        input.schedule
        ?? cronHumanReadable(cronExpression)
        ?? (fireAt ? "Run once" : cronExpression ?? task.schedule),
      cronExpression,
      cronHumanReadable: cronHumanReadable(cronExpression),
      updatedAt: nowIso(),
    };
    // Strip computed fields from persist bag.
    delete updated.jitterSeconds;
    this.tasks.set(id, updated);
    // Keep files map in sync when prompt is edited (residual file body for Uwe/Lwe fire).
    if (typeof input.prompt === "string") {
      this.files.set(id, input.prompt);
    }
    this.save();
    return enrichScheduledTask(updated);
  }

  recordRun(id: string, runAt = new Date()): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.lastRunAt = runAt.toISOString();
    // Residual one-shot complete: fireAt + lastRunAt → disabled (UI "completed").
    if (task.fireAt) {
      task.enabled = false;
    }
    task.updatedAt = nowIso();
    // nextRunAt recomputed on enrich; drop stale stored value.
    delete task.nextRunAt;
    delete task.jitterSeconds;
    this.save();
    return enrichScheduledTask(task);
  }

  getDueScheduledTasks(now = new Date()): ScheduledTask[] {
    // Residual due: enabled + (fireAt pending | nextRunAt with zDA jitter) ≤ now.
    return this.getAllScheduledTasks().filter((task) => {
      if (!task.enabled) return false;
      if (task.fireAt && !task.lastRunAt) {
        const fireMs = Date.parse(task.fireAt);
        return Number.isFinite(fireMs) && fireMs <= now.getTime();
      }
      if (task.nextRunAt) {
        const nextMs = Date.parse(task.nextRunAt);
        return Number.isFinite(nextMs) && nextMs <= now.getTime();
      }
      return false;
    });
  }

  updateScheduledTaskStatus(id: string, status: "enabled" | "disabled" | "deleted"): boolean {
    if (status === "deleted") {
      const deleted = this.tasks.delete(id);
      if (deleted) this.save();
      return deleted;
    }
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = status === "enabled";
    task.updatedAt = nowIso();
    this.save();
    return true;
  }

  getScheduledTaskFileContent(id: string): string {
    return this.files.get(id) ?? "";
  }

  updateScheduledTaskFileContent(id: string, content: string): boolean {
    this.files.set(id, content);
    this.save();
    return true;
  }

  /**
   * Official che residual: suggestions → [{toolName}] from addRules/replaceRules only.
   */
  static extractApprovedToolNamesFromSuggestions(
    suggestions: unknown,
  ): Array<{ toolName: string }> {
    if (!Array.isArray(suggestions)) return [];
    const out: Array<{ toolName: string }> = [];
    for (const raw of suggestions) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (item.type !== "addRules" && item.type !== "replaceRules") continue;
      if (!Array.isArray(item.rules)) continue;
      for (const rule of item.rules) {
        if (!rule || typeof rule !== "object") continue;
        const toolName = (rule as { toolName?: unknown }).toolName;
        if (typeof toolName === "string" && toolName.length > 0) {
          out.push({ toolName });
        }
      }
    }
    return out;
  }

  /**
   * Official ql residual — directory mount tool not auto-approved on scheduled runs
   * (uses userSelectedFolders instead). Cowork: mcp__cowork__request_cowork_directory.
   * Code CCD also uses mcp__ccd_directory__request_directory — treat both as non-auto.
   */
  static readonly DIRECTORY_MOUNT_TOOLS = new Set([
    "mcp__cowork__request_cowork_directory",
    "mcp__ccd_directory__request_directory",
  ]);

  /**
   * Official shouldAutoApprovePermission residual:
   * - no suggestions / no addRules → false
   * - directory mount tools → false
   * - plugin-shim:* rules → false
   * - every rule toolName must already be in task.approvedPermissions
   */
  shouldAutoApprovePermission(
    taskId: string,
    toolName: string,
    suggestions: unknown,
  ): boolean {
    const rules = ScheduledTaskStore.extractApprovedToolNamesFromSuggestions(suggestions);
    if (rules.length === 0) return false;
    if (ScheduledTaskStore.DIRECTORY_MOUNT_TOOLS.has(toolName)) return false;
    if (rules.some((r) => r.toolName.startsWith("plugin-shim:"))) return false;
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const approved = new Set((task.approvedPermissions ?? []).map((p) => p.toolName));
    return rules.every((r) => approved.has(r.toolName));
  }

  /**
   * Official addApprovedPermissions residual — merge new addRules toolNames into task.
   */
  addApprovedPermissions(taskId: string, suggestions: unknown): boolean {
    const rules = ScheduledTaskStore.extractApprovedToolNamesFromSuggestions(suggestions);
    if (rules.length === 0) return false;
    const task = this.tasks.get(taskId);
    if (!task) return false;
    const existing = task.approvedPermissions ?? [];
    const seen = new Set(existing.map((p) => p.toolName));
    const added: Array<{ toolName: string }> = [];
    for (const rule of rules) {
      if (seen.has(rule.toolName)) continue;
      seen.add(rule.toolName);
      added.push({ toolName: rule.toolName });
    }
    if (added.length === 0) return false;
    task.approvedPermissions = [...existing, ...added];
    task.updatedAt = nowIso();
    this.save();
    return true;
  }

  removeApprovedPermission(id: string, toolName: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    const before = task.approvedPermissions ?? [];
    const next = before.filter((permission) => permission.toolName !== toolName);
    // Residual: no matching approval → false (do not soft-true on no-op filter).
    if (next.length === before.length) return false;
    task.approvedPermissions = next;
    task.updatedAt = nowIso();
    this.save();
    return true;
  }

  /**
   * Official clearChromePermissions residual:
   *   already empty → false
   *   else chromePermissionMode/chromeAllowedDomains = undefined → persist + true
   */
  clearChromePermissions(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.chromePermissionMode === undefined && task.chromeAllowedDomains === undefined) {
      return false;
    }
    task.chromePermissionMode = undefined;
    task.chromeAllowedDomains = undefined;
    task.updatedAt = nowIso();
    this.save();
    return true;
  }
}
