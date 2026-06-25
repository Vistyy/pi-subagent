/** Parse child Pi JSON-mode events into a compact fork result. */

import {
  extractResultText,
  formatToolCallPreview,
  getSeenMessageSignatures,
  stableStringify,
} from "./format.js";

const MAX_STORED_ACTIVITIES = 25;

function updateAssistantMetadata(result, message) {
  if (!message || message.role !== "assistant") return;
  if (!result.provider && message.provider) result.provider = message.provider;
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function sanitizeAssistantMessage(message) {
  const sanitized = { ...message };
  delete sanitized.thinking;
  delete sanitized.reasoning;
  delete sanitized.reasoning_content;

  if (Array.isArray(message.content)) {
    sanitized.content = message.content
      .filter((part) => part?.type !== "thinking")
      .map((part) => {
        if (!part || typeof part !== "object") return part;
        const cleanPart = { ...part };
        delete cleanPart.thinking;
        delete cleanPart.reasoning;
        delete cleanPart.reasoning_content;
        return cleanPart;
      });
  }

  return sanitized;
}

function addAssistantMessage(result, message) {
  if (!message || message.role !== "assistant") return false;

  const sanitized = sanitizeAssistantMessage(message);
  updateAssistantMetadata(result, sanitized);

  const signature = stableStringify(sanitized);
  const seen = getSeenMessageSignatures(result);
  if (seen.has(signature)) return false;
  seen.add(signature);

  result.messages.push(sanitized);

  result.usage.turns++;
  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite || 0;
  }

  return true;
}

function addMessages(result, messages) {
  if (!Array.isArray(messages)) return false;
  let changed = false;
  for (const message of messages) {
    if (addAssistantMessage(result, message)) changed = true;
  }
  return changed;
}

function ensureRetryState(result) {
  if (!result.retry || typeof result.retry !== "object") result.retry = {};
  return result.retry;
}

function processAutoRetryStart(event, result) {
  const retry = ensureRetryState(result);
  retry.active = true;
  retry.pending = false;
  retry.success = undefined;
  if (typeof event.attempt === "number") retry.attempt = event.attempt;
  if (typeof event.maxAttempts === "number") retry.maxAttempts = event.maxAttempts;
  if (typeof event.delayMs === "number") retry.delayMs = event.delayMs;
  if (typeof event.errorMessage === "string") retry.errorMessage = event.errorMessage;
  delete retry.finalError;
  result.sawAgentEnd = false;
  return true;
}

function processAutoRetryEnd(event, result) {
  const retry = ensureRetryState(result);
  retry.active = false;
  retry.pending = false;
  retry.success = Boolean(event.success);
  if (typeof event.attempt === "number") retry.attempt = event.attempt;
  if (typeof event.finalError === "string") retry.finalError = event.finalError;
  if (!retry.success) {
    result.stopReason = "error";
    if (retry.finalError) result.errorMessage = retry.finalError;
  }
  return true;
}

function ensureActivities(result) {
  if (!Array.isArray(result.activities)) result.activities = [];
  return result.activities;
}

function addActivity(result, activity) {
  const activities = ensureActivities(result);
  const totalBefore = typeof result.activityCount === "number" ? result.activityCount : activities.length;
  result.activityCount = totalBefore + 1;
  activities.push(activity);
  while (activities.length > MAX_STORED_ACTIVITIES) activities.shift();
  return activity;
}

function latestActivity(result) {
  const activities = Array.isArray(result.activities) ? result.activities : [];
  return activities[activities.length - 1];
}

function latestRunningThinkingActivity(result) {
  const activities = Array.isArray(result.activities) ? result.activities : [];
  for (let i = activities.length - 1; i >= 0; i--) {
    const activity = activities[i];
    if (activity?.type === "thinking" && activity.status === "running") return activity;
  }
  return undefined;
}

function createThinkingActivity(result) {
  return addActivity(result, { type: "thinking", status: "running" });
}

function ensureLatestThinkingActivity(result) {
  return latestRunningThinkingActivity(result) || createThinkingActivity(result);
}

function processMessageUpdateEvent(event, result) {
  const assistantEvent = event.assistantMessageEvent;
  if (!assistantEvent || typeof assistantEvent !== "object") return false;

  switch (assistantEvent.type) {
    case "thinking_start": {
      const currentLatest = latestActivity(result);
      const activity = currentLatest?.type === "thinking" && currentLatest.status === "running" ? currentLatest : createThinkingActivity(result);
      activity.status = "running";
      if (typeof activity.deltaCount !== "number") activity.deltaCount = 0;
      return true;
    }
    case "thinking_delta": {
      const activity = ensureLatestThinkingActivity(result);
      activity.status = "running";
      activity.deltaCount = typeof activity.deltaCount === "number" ? activity.deltaCount + 1 : 1;
      return true;
    }
    case "thinking_end": {
      const activity = ensureLatestThinkingActivity(result);
      activity.status = "completed";
      return true;
    }
    default:
      return false;
  }
}

function findToolActivity(result, toolCallId) {
  if (!toolCallId || !Array.isArray(result.activities)) return undefined;
  return result.activities.find((activity) => activity?.type === "tool" && activity.toolCallId === toolCallId);
}

function ensureToolActivity(result, event) {
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : `unknown-${result.activityCount || 0}`;
  let activity = findToolActivity(result, toolCallId);
  if (!activity) {
    activity = addActivity(result, {
      type: "tool",
      toolCallId,
      toolName: typeof event.toolName === "string" ? event.toolName : "tool",
      status: "running",
    });
  }

  if (typeof event.toolName === "string") activity.toolName = event.toolName;
  if (Object.prototype.hasOwnProperty.call(event, "args")) {
    activity.displayText = formatToolCallPreview(activity.toolName, event.args);
  }
  if (!activity.displayText) activity.displayText = activity.toolName;
  return activity;
}

function processToolExecutionEvent(event, result) {
  const activity = ensureToolActivity(result, event);

  switch (event.type) {
    case "tool_execution_start":
      activity.status = "running";
      activity.isError = false;
      activity.latestText = "";
      return true;
    case "tool_execution_update": {
      activity.status = "running";
      activity.isError = false;
      const latestText = extractResultText(event.partialResult);
      if (latestText) activity.latestText = latestText;
      return true;
    }
    case "tool_execution_end": {
      activity.status = event.isError ? "error" : "completed";
      activity.isError = Boolean(event.isError);
      const latestText = extractResultText(event.result);
      if (event.isError && latestText) activity.latestText = latestText;
      else delete activity.latestText;
      return true;
    }
    default:
      return false;
  }
}

export function processPiEvent(event, result) {
  if (!event || typeof event !== "object") return false;

  switch (event.type) {
    case "message_update":
      return processMessageUpdateEvent(event, result);
    case "message_end":
      return addAssistantMessage(result, event.message);
    case "turn_end": {
      let changed = false;
      if (addAssistantMessage(result, event.message)) changed = true;
      if (addMessages(result, event.toolResults)) changed = true;
      return changed;
    }
    case "agent_end":
      result.sawAgentEnd = true;
      return addMessages(result, event.messages);
    case "auto_retry_start":
      return processAutoRetryStart(event, result);
    case "auto_retry_end":
      return processAutoRetryEnd(event, result);
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return processToolExecutionEvent(event, result);
    default:
      return false;
  }
}

export function processPiJsonLine(line, result) {
  if (!line.trim()) return false;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }
  return processPiEvent(event, result);
}

export { getFinalAssistantText, getResultSummaryText } from "./text.js";
export { getChildProgressText } from "./progress.js";
