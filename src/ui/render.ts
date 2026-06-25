import { getMarkdownTheme, keyHint } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getFinalAssistantText } from "../child-events/index.js";
import { type SubagentResult, isResultError, isResultSuccess } from "../core/types.js";

const COLLAPSED_ACTIVITY_COUNT = 8;
const COLLAPSED_OUTPUT_LINES = 3;
const MAX_TASK_PREVIEW_CHARS = 72;
const MAX_TEXT_PREVIEW_CHARS = 280;
const MAX_ERROR_PREVIEW_CHARS = 1200;
const MAX_INLINE_ERROR_PREVIEW_CHARS = 160;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function taskPreview(task: unknown): string {
  if (typeof task !== "string" || !task.trim()) return "...";
  return truncate(task.replace(/\s+/g, " ").trim(), MAX_TASK_PREVIEW_CHARS);
}

function textPreview(text: string, maxChars = MAX_TEXT_PREVIEW_CHARS): string {
  return truncate(text.trim().split(/\r?\n/).slice(0, COLLAPSED_OUTPUT_LINES).join("\n"), maxChars);
}

function inlinePreview(text: string, maxChars = MAX_INLINE_ERROR_PREVIEW_CHARS): string {
  return truncate(text.replace(/\s+/g, " ").trim(), maxChars);
}

function fmtCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtModelProvider(result: SubagentResult): string {
  const provider = result.provider?.trim();
  let model = result.model?.trim();
  if (provider && model?.startsWith(`${provider}/`)) model = model.slice(provider.length + 1);

  if (provider && model) return `(${provider}) ${model}`;
  if (provider) return `(${provider})`;
  return model || "";
}

function fmtContextFill(contextTokens: number | undefined, contextWindow: number | undefined): string {
  if (!contextTokens || !contextWindow || contextTokens <= 0 || contextWindow <= 0) return "";
  if (!Number.isFinite(contextTokens) || !Number.isFinite(contextWindow)) return "";
  return `${((contextTokens / contextWindow) * 100).toFixed(1)}%/${fmtCount(contextWindow)}`;
}

function fmtUsage(result: SubagentResult): string {
  const usage = result.usage;
  if (!usage) return "";

  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input) parts.push(`↑${fmtCount(usage.input)}`);
  if (usage.output) parts.push(`↓${fmtCount(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${fmtCount(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${fmtCount(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  const contextFill = fmtContextFill(usage.contextTokens, usage.contextWindow);
  if (contextFill) parts.push(contextFill);
  const modelProvider = fmtModelProvider(result);
  if (modelProvider) parts.push(modelProvider);
  return parts.join(" ");
}

function getResults(toolResult: any): SubagentResult[] {
  const results = toolResult?.details?.results;
  return Array.isArray(results) ? results : [];
}

function getFallbackText(toolResult: any): string {
  const content = toolResult?.content;
  if (!Array.isArray(content)) return "(no output)";
  const text = content.find((part) => part?.type === "text" && typeof part.text === "string");
  return text?.text || "(no output)";
}

function subagentStatus(result: SubagentResult): "running" | "success" | "error" {
  if (result.exitCode === -1) return "running";
  if (isResultSuccess(result)) return "success";
  if (isResultError(result)) return "error";
  return "error";
}

function subagentIcon(result: SubagentResult, fg: (color: any, text: string) => string): string {
  const status = subagentStatus(result);
  if (status === "running") return fg("warning", "…");
  if (status === "error") return fg("error", "×");
  return fg("success", "✓");
}

function statusLabel(status: "running" | "success" | "error"): string {
  if (status === "running") return "running";
  if (status === "success") return "completed";
  return "failed";
}

function toolIcon(tool: any, fg: (color: any, text: string) => string): string {
  if (tool?.status === "running") return fg("warning", "…");
  if (tool?.status === "error" || tool?.isError) return fg("error", "×");
  return fg("success", "✓");
}

function toolLabel(tool: any): string {
  return tool?.displayText || tool?.toolName || "tool";
}

function toolErrorSuffix(tool: any, fg: (color: any, text: string) => string): string {
  if (tool?.status !== "error" && !tool?.isError) return "";
  if (typeof tool.latestText !== "string" || !tool.latestText.trim()) return "";
  return fg("error", ` - ${inlinePreview(tool.latestText)}`);
}

function latestToolWithPreview(result: SubagentResult): any | undefined {
  const activities = Array.isArray(result.activities) ? result.activities : [];
  for (let i = activities.length - 1; i >= 0; i--) {
    const activity = activities[i];
    if (activity?.type === "tool" && activity.status === "running" && activity.latestText) return activity;
  }
  return undefined;
}

function thinkingLine(thinking: any, fg: (color: any, text: string) => string): string {
  if (!thinking) return "";
  const icon = thinking.status === "running" ? fg("warning", "…") : fg("success", "✓");
  const count = typeof thinking.deltaCount === "number" && thinking.deltaCount > 0 ? ` (${thinking.deltaCount} chunks)` : "";
  const label = thinking.status === "running" ? `thinking...${count}` : `thinking${count}`;
  return `${icon} ${fg("toolOutput", label)}`;
}

function storedActivities(result: SubagentResult): any[] {
  return Array.isArray(result.activities) ? [...result.activities] : [];
}

function totalActivityCount(result: SubagentResult, stored: any[]): number {
  return typeof result.activityCount === "number" ? Math.max(result.activityCount, stored.length) : stored.length;
}

function activityLine(activity: any, fg: (color: any, text: string) => string): string {
  if (activity?.type === "thinking") return thinkingLine(activity, fg);
  if (activity?.type === "tool") {
    return `${toolIcon(activity, fg)} ${fg(activity?.status === "error" ? "error" : "toolOutput", toolLabel(activity))}${toolErrorSuffix(activity, fg)}`;
  }
  return "";
}

function renderActivityLines(result: SubagentResult, fg: (color: any, text: string) => string, limit?: number): string {
  const activities = storedActivities(result);
  const lines: string[] = [];
  const toShow = limit ? activities.slice(-limit) : activities;
  const skipped = Math.max(0, totalActivityCount(result, activities) - toShow.length);

  if (skipped > 0) lines.push(fg("muted", `... ${skipped} earlier activit${skipped === 1 ? "y" : "ies"}`));

  for (const activity of toShow) {
    const line = activityLine(activity, fg);
    if (line) lines.push(line);
  }

  const previewTool = latestToolWithPreview(result);
  if (previewTool?.latestText) {
    lines.push("");
    lines.push(fg("toolOutput", textPreview(previewTool.latestText, MAX_TEXT_PREVIEW_CHARS)));
  }

  return lines.join("\n").trimEnd();
}

function errorText(result: SubagentResult): string {
  const message = result.errorMessage?.trim() || result.stderr?.trim() || "";
  return message ? truncate(message, MAX_ERROR_PREVIEW_CHARS) : "";
}

function addSection(container: Container, title: string, child: any, fg: (color: any, text: string) => string) {
  container.addChild(new Spacer(1));
  container.addChild(new Text(fg("muted", title), 0, 0));
  container.addChild(child);
}

function renderOneResult(result: SubagentResult, expanded: boolean, theme: any): Container | Text {
  const fg = theme.fg.bind(theme);
  const status = subagentStatus(result);
  const icon = subagentIcon(result, fg);
  const finalOutput = getFinalAssistantText(result.messages);
  const usage = fmtUsage(result);
  const activitiesText = renderActivityLines(result, fg, expanded ? undefined : COLLAPSED_ACTIVITY_COUNT);
  const mdTheme = getMarkdownTheme();
  const identity = `${result.agent}${result.agentSource && result.agentSource !== "unknown" ? ` (${result.agentSource})` : ""}`;

  if (expanded) {
    const container = new Container();
    container.addChild(new Spacer(1));
    container.addChild(new Text(`${icon} ${fg("toolTitle", theme.bold(identity))} ${fg("muted", statusLabel(status))}`, 0, 0));

    addSection(container, "--- Task ---", new Text(fg("dim", result.task || "..."), 0, 0), fg);

    if (activitiesText) addSection(container, "--- Activity ---", new Text(activitiesText, 0, 0), fg);

    if (finalOutput) {
      addSection(container, "--- Output ---", new Markdown(finalOutput.trim(), 0, 0, mdTheme), fg);
    } else if (status !== "running") {
      addSection(container, "--- Output ---", new Text(fg("muted", "(no final response)"), 0, 0), fg);
    }

    const err = status === "error" ? errorText(result) : "";
    if (err) addSection(container, "--- Error ---", new Text(fg("error", err), 0, 0), fg);

    if (usage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(fg("dim", usage), 0, 0));
    }

    return container;
  }

  let text = `${icon} ${fg("toolTitle", theme.bold(identity))} ${fg("muted", statusLabel(status))}`;

  if (activitiesText) {
    text += `\n${activitiesText}`;
  } else if (status === "running") {
    text += `\n${fg("muted", "(running...)")}`;
  } else if (finalOutput) {
    text += `\n${fg("toolOutput", textPreview(finalOutput))}`;
  } else {
    text += `\n${fg("muted", "(no final response)")}`;
  }

  if (status === "error") {
    const err = errorText(result);
    if (err) text += `\n${fg("error", textPreview(err))}`;
  }

  if (usage) text += `\n${fg("dim", usage)}`;

  const activities = storedActivities(result);
  const totalActivities = totalActivityCount(result, activities);
  if (totalActivities > COLLAPSED_ACTIVITY_COUNT || finalOutput || status !== "running") {
    text += `\n${fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
  }

  return new Text(text, 0, 0);
}

function summarizeParallel(results: SubagentResult[], theme: any): string {
  const fg = theme.fg.bind(theme);
  const running = results.filter((result) => result.exitCode === -1).length;
  const failed = results.filter((result) => result.exitCode !== -1 && isResultError(result)).length;
  const completed = results.length - running - failed;
  const icon = running > 0 ? fg("warning", "…") : failed > 0 ? fg("warning", "◐") : fg("success", "✓");
  return `${icon} ${fg("toolTitle", theme.bold("subagents"))} ${fg("muted", `${completed}/${results.length} completed${failed ? `, ${failed} failed` : ""}${running ? `, ${running} running` : ""}`)}`;
}

export function renderSubagentCall(args: any, theme: any) {
  const fg = theme.fg.bind(theme);

  if (Array.isArray(args?.tasks) && args.tasks.length > 0) {
    const names = args.tasks.slice(0, 3).map((task: any) => task?.agent || "?").join(", ");
    const suffix = args.tasks.length > 3 ? `, +${args.tasks.length - 3}` : "";
    return new Text(`${fg("toolTitle", theme.bold("subagent"))} ${fg("accent", `parallel ${args.tasks.length}`)} ${fg("muted", `[${names}${suffix}]`)}`, 0, 0);
  }

  if (Array.isArray(args?.chain) && args.chain.length > 0) {
    const names = args.chain.slice(0, 3).map((step: any) => step?.agent || "?").join(" -> ");
    const suffix = args.chain.length > 3 ? ` -> +${args.chain.length - 3}` : "";
    return new Text(`${fg("toolTitle", theme.bold("subagent"))} ${fg("accent", `chain ${args.chain.length}`)} ${fg("muted", `[${names}${suffix}]`)}`, 0, 0);
  }

  const agent = typeof args?.agent === "string" ? args.agent : "...";
  const text = `${fg("toolTitle", theme.bold("subagent"))} ${fg("accent", agent)} ${fg("dim", taskPreview(args?.task))}`;
  return new Text(text, 0, 0);
}

export function renderSubagentResult(toolResult: any, { expanded }: { expanded: boolean }, theme: any) {
  const results = getResults(toolResult);
  if (results.length === 0) return new Text(getFallbackText(toolResult), 0, 0);

  if (results.length === 1) return renderOneResult(results[0], expanded, theme);

  const container = new Container();
  container.addChild(new Spacer(1));
  container.addChild(new Text(summarizeParallel(results, theme), 0, 0));

  if (expanded) {
    for (const result of results) {
      container.addChild(renderOneResult(result, true, theme));
    }
    return container;
  }

  const fg = theme.fg.bind(theme);
  for (const result of results) {
    const status = subagentStatus(result);
    const icon = subagentIcon(result, fg);
    const identity = `${result.agent}${result.agentSource && result.agentSource !== "unknown" ? ` (${result.agentSource})` : ""}`;
    const finalOutput = getFinalAssistantText(result.messages);
    container.addChild(new Text(`${icon} ${fg("accent", identity)} ${fg("muted", statusLabel(status))}`, 0, 0));
    if (finalOutput) container.addChild(new Text(fg("toolOutput", textPreview(finalOutput, 160)), 0, 0));
  }
  container.addChild(new Text(fg("muted", `(${keyHint("app.tools.expand", "to expand")})`), 0, 0));
  return container;
}
