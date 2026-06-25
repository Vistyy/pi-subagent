import type { Message } from "@earendil-works/pi-ai";
import { getFinalAssistantText } from "../child-events/index.js";
import type { AgentSource } from "../agents.js";

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

export interface SubagentToolActivity {
  type: "tool";
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "error";
  displayText?: string;
  latestText?: string;
  isError?: boolean;
}

export interface SubagentThinkingActivity {
  type: "thinking";
  status: "running" | "completed";
  deltaCount?: number;
}

export type SubagentActivity = SubagentToolActivity | SubagentThinkingActivity;

export interface SubagentRetryState {
  active?: boolean;
  pending?: boolean;
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
  success?: boolean;
}

export interface SubagentResult {
  agent: string;
  agentSource: AgentSource | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  provider?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  sawAgentEnd?: boolean;
  retry?: SubagentRetryState;
  activityCount?: number;
  activities?: SubagentActivity[];
}

export interface SubagentDetails {
  mode: "invalid" | "single" | "parallel" | "chain";
  agentDirs: {
    user: string;
    project: string;
    projectTrusted: boolean;
  };
  results: SubagentResult[];
}

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

export function hasFinalAssistantOutput(result: Pick<SubagentResult, "messages">): boolean {
  return getFinalAssistantText(result.messages).trim().length > 0;
}

export function hasSemanticCompletion(result: Pick<SubagentResult, "messages" | "sawAgentEnd">): boolean {
  return Boolean(result.sawAgentEnd) && hasFinalAssistantOutput(result);
}

export function isResultSuccess(result: SubagentResult): boolean {
  if (result.exitCode === -1) return false;
  if (result.retry?.success === false) return false;
  if (hasSemanticCompletion(result)) return true;
  return result.exitCode === 0 && result.stopReason !== "error" && result.stopReason !== "aborted" && hasFinalAssistantOutput(result);
}

export function isResultError(result: SubagentResult): boolean {
  if (result.exitCode === -1) return false;
  return !isResultSuccess(result);
}

export function normalizeCompletedResult(result: SubagentResult, wasAborted: boolean): SubagentResult {
  const hasSemanticSuccess = result.retry?.success === false ? false : hasSemanticCompletion(result);

  if (wasAborted) {
    if (hasSemanticSuccess) {
      result.exitCode = 0;
      if (result.stopReason === "aborted") result.stopReason = undefined;
      if (result.errorMessage === "Subagent was aborted.") result.errorMessage = undefined;
    } else {
      result.exitCode = 130;
      result.stopReason = "aborted";
      result.errorMessage = "Subagent was aborted.";
      if (!result.stderr.trim()) result.stderr = "Subagent was aborted.";
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
    result.errorMessage = "Subagent exited without a final assistant response.";
    if (!result.stderr.trim()) result.stderr = result.errorMessage;
  }

  return result;
}

export function getFinalOutput(messages: Message[]): string {
  return getFinalAssistantText(messages);
}
