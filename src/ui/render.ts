import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getFinalAssistantText } from "../child-events/index.js";
import { type ChildResult, type SubagentResult, isResultError, isResultSuccess } from "../core/types.js";

const MAX_TASK_PREVIEW_CHARS = 72;
const MAX_TEXT_PREVIEW_CHARS = 160;
const MAX_ERROR_PREVIEW_CHARS = 1200;

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function taskPreview(task: unknown): string {
  if (typeof task !== "string" || !task.trim()) return "...";
  return truncate(task.replace(/\s+/g, " ").trim(), MAX_TASK_PREVIEW_CHARS);
}

function singleLinePreview(text: string, maxChars = MAX_TEXT_PREVIEW_CHARS): string {
  return truncate(text.replace(/\s+/g, " ").trim(), maxChars);
}

function fmtCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function fmtDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function fmtUsage(result: ChildResult): string {
  const usage = result.usage;
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input) parts.push(`↑${fmtCount(usage.input)}`);
  if (usage.output) parts.push(`↓${fmtCount(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${fmtCount(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${fmtCount(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens && usage.contextWindow) {
    parts.push(`${((usage.contextTokens / usage.contextWindow) * 100).toFixed(1)}%/${fmtCount(usage.contextWindow)}`);
  }
  const provider = result.provider?.trim();
  let model = result.model?.trim();
  if (provider && model?.startsWith(`${provider}/`)) model = model.slice(provider.length + 1);
  if (provider && model) parts.push(`(${provider}) ${model}`);
  else if (provider) parts.push(`(${provider})`);
  else if (model) parts.push(model);
  if (result.thinking) parts.push(`· ${result.thinking}`);

  const elapsed = result.exitCode === -1 && result.startedAt
    ? Math.max(result.durationMs ?? 0, Date.now() - result.startedAt)
    : result.durationMs;
  const duration = elapsed === undefined ? "" : fmtDuration(elapsed);
  if (duration && parts.length > 0) return `${duration} · ${parts.join(" ")}`;
  return duration || parts.join(" ");
}

function getPrimaryResult(toolResult: any): ChildResult | undefined {
  const results = toolResult?.details?.results;
  return Array.isArray(results) ? results[0] : undefined;
}

function fallbackText(toolResult: any): string {
  const text = toolResult?.content?.find?.((part: any) => part?.type === "text" && typeof part.text === "string");
  return text?.text || "(no output)";
}

function status(result: ChildResult): "running" | "completed" | "failed" {
  if (result.exitCode === -1) return "running";
  if (isResultSuccess(result)) return "completed";
  return "failed";
}

function statusIcon(result: ChildResult, fg: (color: any, text: string) => string): string {
  if (result.exitCode === -1) return fg("warning", "…");
  return isResultError(result) ? fg("error", "×") : fg("success", "✓");
}

function activityLine(activity: any, fg: (color: any, text: string) => string): string {
  if (activity?.type === "thinking") {
    const icon = activity.status === "running" ? fg("warning", "…") : fg("success", "✓");
    return `${icon} ${fg("toolOutput", activity.status === "running" ? "thinking..." : "thinking")}`;
  }
  if (activity?.type !== "tool") return "";
  const icon = activity.status === "running"
    ? fg("warning", "…")
    : activity.status === "error" || activity.isError
      ? fg("error", "×")
      : fg("success", "✓");
  const label = activity.displayText || activity.toolName || "tool";
  const error = activity.latestText && (activity.status === "error" || activity.isError)
    ? ` - ${truncate(activity.latestText.replace(/\s+/g, " ").trim(), 160)}`
    : "";
  return `${icon} ${fg(activity.status === "error" ? "error" : "toolOutput", label)}${fg("error", error)}`;
}

function activityText(
  result: ChildResult,
  fg: (color: any, text: string) => string,
  limit?: number,
): string {
  const activities = Array.isArray(result.activities) ? result.activities : [];
  const visible = limit ? activities.slice(-limit) : activities;
  const total = Math.max(result.activityCount ?? 0, activities.length);
  const skipped = Math.max(0, total - visible.length);
  const lines = skipped > 0
    ? [fg("muted", `… ${skipped} earlier activit${skipped === 1 ? "y" : "ies"}`)]
    : [];
  for (const activity of visible) {
    const line = activityLine(activity, fg);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function resultTitle(result: ChildResult): string {
  const subagent = result as Partial<SubagentResult>;
  if (!subagent.agent) return "fork";
  return subagent.agentSource
    ? `${subagent.agent} (${subagent.agentSource})`
    : subagent.agent;
}

function addSection(container: Container, title: string, child: Text | Markdown, fg: (color: any, text: string) => string): void {
  container.addChild(new Spacer(1));
  container.addChild(new Text(fg("muted", title), 0, 0));
  container.addChild(child);
}

function renderResult(toolResult: any, expanded: boolean, theme: any): Container | Text {
  const result = getPrimaryResult(toolResult);
  if (!result) return new Text(fallbackText(toolResult), 0, 0);

  const fg = theme.fg.bind(theme);
  const icon = statusIcon(result, fg);
  const label = status(result);
  const finalOutput = getFinalAssistantText(result.messages);
  const error = result.errorMessage?.trim() || result.stderr?.trim();

  if (expanded) {
    const title = resultTitle(result);
    const activities = activityText(result, fg);
    const usage = fmtUsage(result);
    const container = new Container();
    container.addChild(new Spacer(1));
    container.addChild(new Text(`${icon} ${fg("toolTitle", theme.bold(title))} ${fg("muted", label)}`, 0, 0));
    addSection(container, "--- Task ---", new Text(fg("dim", result.task || "..."), 0, 0), fg);
    if (activities) addSection(container, "--- Activity ---", new Text(activities, 0, 0), fg);
    if (finalOutput) addSection(container, "--- Output ---", new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()), fg);
    else if (label !== "running") addSection(container, "--- Output ---", new Text(fg("muted", "(no final response)"), 0, 0), fg);
    if (label === "failed" && error) addSection(container, "--- Error ---", new Text(fg("error", truncate(error, MAX_ERROR_PREVIEW_CHARS)), 0, 0), fg);
    if (usage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(fg("dim", usage), 0, 0));
    }
    return container;
  }

  const activities = activityText(result, fg, 3);
  const usage = fmtUsage(result);
  let text = `${icon} ${fg("muted", label)}`;
  if (activities) text += `\n${activities}`;
  else if (label === "running") text += `\n${fg("muted", "running...")}`;
  else if (finalOutput) text += `\n${fg("toolOutput", singleLinePreview(finalOutput))}`;
  else text += `\n${fg("muted", "no final response")}`;
  if (label === "failed" && error) text += `\n${fg("error", singleLinePreview(error))}`;
  if (usage) text += `\n${fg("dim", usage)}`;
  return new Text(text, 0, 0);
}

export function renderSubagentCall(args: any, theme: any): Text {
  const fg = theme.fg.bind(theme);
  const agent = typeof args?.agent === "string" ? args.agent : "...";
  return new Text(`${fg("toolTitle", theme.bold("subagent"))} ${fg("accent", agent)} ${fg("dim", taskPreview(args?.task))}`, 0, 0);
}

export function renderForkCall(args: any, theme: any): Text {
  const fg = theme.fg.bind(theme);
  const effort = typeof args?.effort === "string" ? ` ${fg("muted", `[${args.effort}]`)}` : "";
  return new Text(`${fg("toolTitle", theme.bold("fork"))}${effort} ${fg("dim", taskPreview(args?.task))}`, 0, 0);
}

export function renderSubagentResult(toolResult: any, options: { expanded: boolean }, theme: any): Container | Text {
  return renderResult(toolResult, options.expanded, theme);
}

export function renderForkResult(toolResult: any, options: { expanded: boolean }, theme: any): Container | Text {
  return renderResult(toolResult, options.expanded, theme);
}
