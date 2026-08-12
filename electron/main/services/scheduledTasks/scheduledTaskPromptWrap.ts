/**
 * Official scheduled-task automated-run prompt residual (index-BELzQL5P):
 * - Lwe: automated-run system preamble (user not present)
 * - Rwe: legacy preamble variants stripped by Dwe (display only; not used on fire)
 * - Uwe: strip YAML frontmatter from task file body
 * - Pwe: leading `/skill` → Skill-tool invoke prefix
 * - Fwe / pYt wrap: `<scheduled-task name file>\n${Lwe}\n\n${skill?}${body}\n</scheduled-task>`
 *
 * Fire path residual: session_started → getScheduledTaskFileContent → Uwe → wrap → start.
 * Product host pump / Run now use the same wrap body (no invent remote jEe / no invent jT.run).
 */

/** Official Lwe. */
export const SCHEDULED_TASK_AUTOMATED_RUN_PROMPT =
  'This is an automated run of a scheduled task. The user is not present to answer questions. For implementation details, execute autonomously without asking clarifying questions — make reasonable choices and note them in your output. "write" actions (e.g. MCP tools that send, post, create, update, or delete), only take them if the task file asks for that specific action. When in doubt, producing a report of what you found is the correct output.';

/** Official Pwe — skill slash at body start. */
const SCHEDULED_TASK_SKILL_PREFIX = /^\/([a-zA-Z][\w:.-]*)/;

/** Official Uwe: drop leading YAML frontmatter fence. */
export function stripScheduledTaskFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n+/, "").trim();
}

/**
 * Official pYt inner wrap (extends Fwe with optional skill invoke).
 * name residual = scheduledTaskId; file residual = task.filePath (may be empty product-side).
 */
export function wrapScheduledTaskRunPrompt(
  name: string,
  file: string,
  body: string,
): string {
  const skillMatch = body.match(SCHEDULED_TASK_SKILL_PREFIX);
  const skillPrefix = skillMatch
    ? `Invoke the skill "${skillMatch[1]}" using the Skill tool, then follow the remaining instructions.\n\n`
    : "";
  return `<scheduled-task name="${name}" file="${file}">\n${SCHEDULED_TASK_AUTOMATED_RUN_PROMPT}\n\n${skillPrefix}${body}\n</scheduled-task>`;
}

/**
 * Resolve fire message for host pump / run-now.
 * Residual: prefer file content (Uwe); fall back to task.prompt for legacy rows not yet seeded into files map.
 * Returns null when body empty after strip (official pYt aborts).
 */
export function resolveScheduledTaskRunMessage(input: {
  taskId: string;
  /** Official filePath attribute; product may omit. */
  filePath?: string;
  fileContent?: string;
  prompt?: string;
}): string | null {
  const raw =
    (typeof input.fileContent === "string" && input.fileContent.trim().length > 0
      ? input.fileContent
      : undefined)
    ?? (typeof input.prompt === "string" && input.prompt.trim().length > 0
      ? input.prompt
      : undefined)
    ?? "";
  const body = stripScheduledTaskFrontmatter(raw);
  if (!body) return null;
  return wrapScheduledTaskRunPrompt(
    input.taskId,
    typeof input.filePath === "string" ? input.filePath : "",
    body,
  );
}
