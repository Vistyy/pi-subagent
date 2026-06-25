import { getFinalAssistantText } from "./text.js";
import { MAX_INLINE_ERROR_PREVIEW_CHARS, truncateInline } from "./format.js";

function formatToolStatusIcon(tool) {
  if (tool?.status === "running") return "…";
  if (tool?.status === "error") return "×";
  return "✓";
}

function formatToolErrorSuffix(tool) {
  if (tool?.status !== "error" && !tool?.isError) return "";
  if (typeof tool.latestText !== "string" || !tool.latestText.trim()) return "";
  return ` - ${truncateInline(tool.latestText, MAX_INLINE_ERROR_PREVIEW_CHARS)}`;
}

function formatThinkingActivityProgress(thinking) {
  if (!thinking || typeof thinking !== "object") return "";
  const icon = thinking.status === "running" ? "…" : "✓";
  const count = typeof thinking.deltaCount === "number" && thinking.deltaCount > 0 ? ` (${thinking.deltaCount} chunks)` : "";
  const label = thinking.status === "running" ? `thinking...${count}` : `thinking${count}`;
  return `${icon} ${label}`;
}

function formatActivityProgress(activity) {
  if (activity?.type === "thinking") return formatThinkingActivityProgress(activity);
  if (activity?.type === "tool") return `${formatToolStatusIcon(activity)} ${activity.displayText || activity.toolName || "tool"}${formatToolErrorSuffix(activity)}`;
  return "";
}

function storedActivities(result) {
  const activities = Array.isArray(result?.activities) ? result.activities : [];
  return activities.filter((activity) => activity && typeof activity === "object");
}

function totalActivities(result, activities) {
  return typeof result?.activityCount === "number" ? Math.max(result.activityCount, activities.length) : activities.length;
}

function formatRetryProgress(retry) {
  if (!retry || typeof retry !== "object" || !retry.active) return "";
  const attempt = typeof retry.attempt === "number" ? retry.attempt : undefined;
  const maxAttempts = typeof retry.maxAttempts === "number" ? retry.maxAttempts : undefined;
  const attemptText = attempt && maxAttempts ? `attempt ${attempt}/${maxAttempts}` : attempt ? `attempt ${attempt}` : "retrying";
  const delayText = typeof retry.delayMs === "number" && retry.delayMs > 0 ? `, waiting ${Math.round(retry.delayMs / 1000)}s` : "";
  const errorText = typeof retry.errorMessage === "string" && retry.errorMessage.trim() ? ` after ${truncateInline(retry.errorMessage.trim(), MAX_INLINE_ERROR_PREVIEW_CHARS)}` : "";
  return `Retrying${errorText} (${attemptText}${delayText})`;
}

function formatActivityProgressList(result) {
  const activities = storedActivities(result);
  const lines = [];
  const toShow = activities.slice(-10);
  const skipped = Math.max(0, totalActivities(result, activities) - toShow.length);
  if (skipped > 0) lines.push(`... ${skipped} earlier activit${skipped === 1 ? "y" : "ies"}`);
  for (const activity of toShow) {
    const line = formatActivityProgress(activity);
    if (line) lines.push(line);
  }
  return lines.join("\n").trim();
}

export function getChildProgressText(result) {
  const retryProgress = formatRetryProgress(result?.retry);
  if (retryProgress) return retryProgress;

  const finalText = getFinalAssistantText(result?.messages);
  if (finalText) return finalText;

  const activityProgress = formatActivityProgressList(result);
  if (activityProgress) return activityProgress;

  if (typeof result?.errorMessage === "string" && result.errorMessage.trim()) return result.errorMessage.trim();
  return "(running...)";
}
