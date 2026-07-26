import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

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

function nextRunAt(cronExpression?: string, after = new Date()): string | undefined {
  if (!cronExpression) return undefined;
  const [minuteRaw, hourRaw, , , dayRaw] = cronExpression.split(" ");
  const minute = Number(minuteRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  const cursor = new Date(after);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let attempts = 0; attempts < 366 * 24 * 60; attempts += 1) {
    const hourMatches = hourRaw === "*" || cursor.getHours() === Number(hourRaw);
    const minuteMatches = cursor.getMinutes() === minute;
    const dayMatches = !dayRaw || dayRaw === "*" || (dayRaw === "1-5" ? cursor.getDay() >= 1 && cursor.getDay() <= 5 : cursor.getDay() === Number(dayRaw));
    if (hourMatches && minuteMatches && dayMatches) return cursor.toISOString();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return undefined;
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
    if (!channel) return all;
    return all.filter((task) => scheduledTaskVisibleOnChannel(task, channel));
  }

  getScheduledTask(id: string, channel?: ScheduledTaskChannel): ScheduledTask | null {
    const task = this.tasks.get(id) ?? null;
    if (!task) return null;
    if (channel && !scheduledTaskVisibleOnChannel(task, channel)) return null;
    return task;
  }

  createScheduledTask(input: Partial<ScheduledTask> & { name?: string; title?: string }): ScheduledTask {
    const timestamp = nowIso();
    const title = input.title ?? input.name ?? "Scheduled task";
    const cronExpression = input.cronExpression;
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
      schedule: input.schedule ?? cronHumanReadable(cronExpression) ?? cronExpression ?? "Manual",
      cronExpression,
      cronHumanReadable: cronHumanReadable(cronExpression),
      cwd: input.cwd,
      model: input.model,
      nextRunAt: input.nextRunAt ?? nextRunAt(cronExpression),
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
    };
    this.tasks.set(task.id, task);
    this.save();
    return task;
  }

  updateScheduledTask(id: string, input: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    const cronExpression = input.cronExpression ?? task.cronExpression;
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
    const updated: ScheduledTask = {
      ...task,
      ...input,
      id,
      spaceId,
      channel,
      schedule: input.schedule ?? cronHumanReadable(cronExpression) ?? cronExpression ?? task.schedule,
      cronExpression,
      cronHumanReadable: cronHumanReadable(cronExpression),
      nextRunAt: input.nextRunAt ?? nextRunAt(cronExpression),
      updatedAt: nowIso(),
    };
    this.tasks.set(id, updated);
    this.save();
    return updated;
  }

  recordRun(id: string, runAt = new Date()): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.lastRunAt = runAt.toISOString();
    task.nextRunAt = nextRunAt(task.cronExpression, runAt);
    task.updatedAt = nowIso();
    this.save();
    return task;
  }

  getDueScheduledTasks(now = new Date()): ScheduledTask[] {
    return this.getAllScheduledTasks().filter((task) => task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime());
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

  removeApprovedPermission(id: string, toolName: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.approvedPermissions = (task.approvedPermissions ?? []).filter((permission) => permission.toolName !== toolName);
    task.updatedAt = nowIso();
    this.save();
    return true;
  }
}
