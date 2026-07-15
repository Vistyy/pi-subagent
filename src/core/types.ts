import type { Message } from "@earendil-works/pi-ai";
import { getFinalAssistantText } from "../child-events/index.js";
import type { AgentSource } from "../agents.js";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ChildKind = "fork" | "subagent";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  contextWindow?: number;
  turns: number;
}

export interface ChildToolActivity {
  type: "tool";
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "error";
  displayText?: string;
  latestText?: string;
  isError?: boolean;
}

export interface ChildThinkingActivity {
  type: "thinking";
  status: "running" | "completed";
  deltaCount?: number;
}

export type ChildActivity = ChildToolActivity | ChildThinkingActivity;

export interface ChildRetryState {
  active?: boolean;
  pending?: boolean;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
  success?: boolean;
}

export interface ChildResult {
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  startedAt?: number;
  durationMs?: number;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  sawAgentEnd?: boolean;
  retry?: ChildRetryState;
  activityCount?: number;
  activities?: ChildActivity[];
}

export interface SubagentResult extends ChildResult {
  agent: string;
  agentSource: AgentSource | "unknown";
}

export interface ChildDetails<TResult extends ChildResult> {
  results: TResult[];
}

export type SubagentDetails = ChildDetails<SubagentResult>;

export type ForkEffort = "fast" | "balanced" | "deep";
export type ForkEffortSource = "tool" | "default";

export interface ForkEffortProfile {
  provider: string;
  id: string;
  thinking: ThinkingLevel;
}

export interface ForkEffortState {
  selected: ForkEffort;
  source: ForkEffortSource;
  profile?: ForkEffortProfile;
  warning?: string;
}

export interface ForkResult extends ChildResult {
  effort: ForkEffortState;
}

export type ForkDetails = ChildDetails<ForkResult>;

export function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

export function hasFinalAssistantOutput(result: Pick<ChildResult, "messages">): boolean {
  return getFinalAssistantText(result.messages).trim().length > 0;
}

export function hasSemanticCompletion(result: Pick<ChildResult, "messages" | "sawAgentEnd">): boolean {
  return Boolean(result.sawAgentEnd) && hasFinalAssistantOutput(result);
}

export function isResultSuccess(result: ChildResult): boolean {
  if (result.exitCode === -1 || result.retry?.success === false) return false;
  if (hasSemanticCompletion(result)) return true;
  return result.exitCode === 0
    && result.stopReason !== "error"
    && result.stopReason !== "aborted"
    && hasFinalAssistantOutput(result);
}

export function isResultError(result: ChildResult): boolean {
  return result.exitCode !== -1 && !isResultSuccess(result);
}

export function normalizeCompletedResult<T extends ChildResult>(
  result: T,
  wasAborted: boolean,
  kind: ChildKind,
): T {
  const label = kind === "fork" ? "Fork" : "Subagent";
  const hasSemanticSuccess = result.retry?.success === false ? false : hasSemanticCompletion(result);

  if (wasAborted) {
    if (hasSemanticSuccess) {
      result.exitCode = 0;
      if (result.stopReason === "aborted") result.stopReason = undefined;
      if (result.errorMessage === `${label} was aborted.`) result.errorMessage = undefined;
    } else {
      result.exitCode = 130;
      result.stopReason = "aborted";
      result.errorMessage = `${label} was aborted.`;
      if (!result.stderr.trim()) result.stderr = result.errorMessage;
    }
    return result;
  }

  if (result.exitCode > 0) {
    if (hasSemanticSuccess) {
      result.exitCode = 0;
      if (result.stopReason === "error") result.stopReason = undefined;
      if (result.errorMessage === result.stderr.trim()) result.errorMessage = undefined;
    } else {
      if (!result.stopReason) result.stopReason = "error";
      if (!result.errorMessage && result.stderr.trim()) result.errorMessage = result.stderr.trim();
    }
  }

  if (result.exitCode === 0 && !hasFinalAssistantOutput(result)) {
    result.exitCode = 1;
    result.stopReason = "error";
    result.errorMessage = `${label} exited without a final assistant response.`;
    if (!result.stderr.trim()) result.stderr = result.errorMessage;
  }

  return result;
}

export function getFinalOutput(messages: Message[]): string {
  return getFinalAssistantText(messages);
}
