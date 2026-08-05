/**
 * Official writeDispatchSeedMessages residual (app.asar GUA / P6i).
 *
 * GUA(e): Dispatch welcome seed strings; if e truthy, append personal-name prompt.
 * P6i(sessionId, index): deterministic UUID from sha256("dispatch-seed:"+session+":"+index).
 * Seed shape: assistant synthetic tool_use SendUserMessage + idle result.
 *
 * data-official-source: app.asar GUA / P6i / writeDispatchSeedMessages
 */

import { createHash, randomUUID } from "node:crypto";

/** Official GUA residual copy. */
export function dispatchSeedMessages(agentNameEnabled: boolean): string[] {
  const base = [
    `Hey, glad you're here. Tell me what's on your plate, no ask is too big or small. You could ask me to:\n• Find a confirmation in Downloads and check the order status on the site.\n• Open a GitHub project on your computer, make a quick code change, and run the tests.\n• Scan Slack for a bug report, find the file, and open a Code session to fix it.\n• Search your repos for an error message and trace where it comes from.\n\nYou can also control this conversation from your phone. Download the Claude app for iOS or Android, then go to the Dispatch tab.`,
  ];
  if (agentNameEnabled) {
    base.push(
      "I'm your personal Claude. You can choose a name for me whenever you want. Want to pick one now?",
    );
  }
  return base;
}

/** Official P6i — deterministic v4-shaped UUID for seed messages. */
export function dispatchSeedUuid(sessionId: string, index: number): string {
  const t = createHash("sha256")
    .update(`dispatch-seed:${sessionId}:${index}`)
    .digest("hex");
  return (
    t.slice(0, 8) +
    "-" +
    t.slice(8, 12) +
    "-4" +
    t.slice(13, 16) +
    "-" +
    ((parseInt(t[16]!, 16) & 3) | 8).toString(16) +
    t.slice(17, 20) +
    "-" +
    t.slice(20, 32)
  );
}

export type DispatchSeedAssistantMessage = {
  type: "assistant";
  uuid: string;
  session_id: string;
  parent_tool_use_id: null;
  message: {
    role: "assistant";
    id: string;
    model: "<synthetic>";
    type: "message";
    stop_reason: null;
    stop_sequence: null;
    content: Array<{
      type: "tool_use";
      id: string;
      name: "SendUserMessage";
      input: { message: string };
    }>;
  };
};

export type DispatchSeedIdleResult = {
  type: "result";
  subtype: "success";
  duration_ms: 0;
  duration_api_ms: 0;
  is_error: false;
  num_turns: 0;
  session_id: string;
  uuid: string;
};

export function buildDispatchSeedAssistantMessages(
  remoteSessionId: string,
  agentNameEnabled: boolean,
): DispatchSeedAssistantMessage[] {
  return dispatchSeedMessages(agentNameEnabled).map((text, index) => {
    const uuid = dispatchSeedUuid(remoteSessionId, index);
    return {
      type: "assistant",
      uuid,
      session_id: remoteSessionId,
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        id: uuid,
        model: "<synthetic>",
        type: "message",
        stop_reason: null,
        stop_sequence: null,
        content: [
          {
            type: "tool_use",
            id: `dispatch_seed_${index}_${uuid.slice(0, 8)}`,
            name: "SendUserMessage",
            input: { message: text },
          },
        ],
      },
    };
  });
}

export function buildDispatchSeedIdleResult(
  remoteSessionId: string,
): DispatchSeedIdleResult {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 0,
    session_id: remoteSessionId,
    uuid: randomUUID(),
  };
}
