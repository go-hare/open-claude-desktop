export type ScheduledTask = {
  id: string;
  title: string;
  description?: string;
  prompt?: string;
  schedule?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  approvedPermissions?: Array<{ toolName: string }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class ScheduledTaskStore {
  private tasks = new Map<string, ScheduledTask>();
  private files = new Map<string, string>();

  getAllScheduledTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createScheduledTask(input: Partial<ScheduledTask> & { name?: string; title?: string }): ScheduledTask {
    const timestamp = nowIso();
    const title = input.title ?? input.name ?? "Scheduled task";
    const task: ScheduledTask = {
      id: input.id ?? (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `task_${Date.now()}`),
      title,
      description: input.description,
      prompt: input.prompt,
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
      approvedPermissions: input.approvedPermissions ?? [],
    };
    this.tasks.set(task.id, task);
    return task;
  }

  updateScheduledTask(id: string, input: Partial<ScheduledTask>): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    const updated = { ...task, ...input, id, updatedAt: nowIso() };
    this.tasks.set(id, updated);
    return updated;
  }

  updateScheduledTaskStatus(id: string, status: "enabled" | "disabled" | "deleted"): boolean {
    if (status === "deleted") return this.tasks.delete(id);
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = status === "enabled";
    task.updatedAt = nowIso();
    return true;
  }

  getScheduledTaskFileContent(id: string): string {
    return this.files.get(id) ?? "";
  }

  updateScheduledTaskFileContent(id: string, content: string): boolean {
    this.files.set(id, content);
    return true;
  }

  removeApprovedPermission(id: string, toolName: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.approvedPermissions = (task.approvedPermissions ?? []).filter((permission) => permission.toolName !== toolName);
    task.updatedAt = nowIso();
    return true;
  }
}
