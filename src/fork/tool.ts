import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildUsageRecordedData, PI_USAGE_RECORDED } from "../usage.js";
import { EFFORT_LEVELS, loadConfig, type ForkConfig } from "../config.js";
import { type ForkDetails, type ForkEffort, type ForkEffortSource, type ForkEffortState, type ForkResult, isResultError } from "../core/types.js";
import { getResultSummaryText } from "../child-events/index.js";
import { PI_SUBAGENT_CHILD_ENV } from "../runner/env.js";
import { runFork } from "./runner/index.js";
import { writeForkSessionSnapshotJsonl } from "./session-snapshot.js";
import { renderForkCall, renderForkResult } from "../ui/render.js";

export const FORK_TOOL_TEXT = {
  taskDescription:
    "Bounded child task. Preserve the caller's concern count and request only the evidence needed. Include scope, expected output, and limits. The child reports findings; it does not decide outside the task.",
  effortDescription:
    "Child work budget.\nfast: use for one concrete requested result, such as locating a fact, verifying a claim, checking explicit criteria, or answering a focused question. A named behavior remains Fast when checking its safety, caveats, tests, or implementation across multiple artifacts.\nbalanced: use when the child must discover and prioritize unknown concerns, explain a cause spanning related systems, synthesize distinct concerns, or resolve a genuine design trade-off.\ndeep: the required second pass when balanced has already left a named unresolved contradiction, material uncertainty, or insufficient evidence; explicit user selection may enter directly.",
  description:
    "Delegate bounded discovery or review. The child investigates independently and returns a dense report.",
  promptSnippet:
    "Use fork({ task, effort }) for discovery instead of read/bash. If you do not already know the answer, fork first.",
  promptGuidelines: [
    "Known answer → answer directly.",
    "Unknown repo fact/review → fork before read/bash.",
    "Command/path/file lookup is unknown repo fact.",
    "Do not inspect, grep, list, or read first to decide whether to fork.",
    "Parent tools are for edits, validation after fork, and final synthesis.",
    "Multiple independent areas → one fork per area.",
  ],
} as const;

const ForkParams = Type.Object({
  task: Type.String({
    description: FORK_TOOL_TEXT.taskDescription,
  }),
  effort: Type.Optional(StringEnum(EFFORT_LEVELS, {
    description: FORK_TOOL_TEXT.effortDescription,
  })),
});

function makeDetails(results: ForkResult[]): ForkDetails {
  return { results };
}

function recordForkUsage(pi: ExtensionAPI, result: ForkResult): void {
  pi.appendEntry(PI_USAGE_RECORDED, buildUsageRecordedData({
    extension: "fork",
    agent: "child-agent",
    operation: "fork",
    tags: result.effort?.selected ? { effort: result.effort.selected } : undefined,
    model: { provider: result.provider, id: result.model },
    usage: {
      input: result.usage.input,
      output: result.usage.output,
      cacheRead: result.usage.cacheRead,
      cacheWrite: result.usage.cacheWrite,
      totalTokens: result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite,
      cost: result.usage.cost,
    },
  }));
}

function resolveEffortState(
  requestedEffort: unknown,
  config: ForkConfig,
): ForkEffortState {
  const selected = EFFORT_LEVELS.includes(requestedEffort as ForkEffort)
    ? requestedEffort as ForkEffort
    : config.defaultEffort;

  const source: ForkEffortSource = requestedEffort === selected ? "tool" : "default";
  const profile = config.effortProfiles?.[selected];
  if (profile) return { selected, source, profile };

  return {
    selected,
    source,
    warning: source === "tool"
      ? `Requested effort \"${selected}\" has no configured profile; using child Pi defaults.`
      : undefined,
  };
}

function formatResultContent(result: ForkResult, isError: boolean): string {
  const warning = result.effort?.warning ? `Fork warning: ${result.effort.warning}\n\n` : "";
  const summary = getResultSummaryText(result);
  if (isError) return `${warning}Fork ${result.stopReason || "failed"}: ${summary}`;
  return `${warning}${summary}`;
}

export function resolveModelContextWindow(
  modelRegistry: ExtensionContext["modelRegistry"],
  provider?: string,
  model?: string,
): number | undefined {
  const trimmedProvider = provider?.trim();
  const trimmedModel = model?.trim();
  if (!trimmedModel) return undefined;

  const attempts: Array<[string, string]> = [];
  if (trimmedProvider) {
    attempts.push([trimmedProvider, trimmedModel]);
    if (trimmedModel.startsWith(`${trimmedProvider}/`)) {
      attempts.push([trimmedProvider, trimmedModel.slice(trimmedProvider.length + 1)]);
    }
  } else {
    const slashIndex = trimmedModel.indexOf("/");
    if (slashIndex > 0 && slashIndex < trimmedModel.length - 1) {
      attempts.push([trimmedModel.slice(0, slashIndex), trimmedModel.slice(slashIndex + 1)]);
    }
  }

  for (const [attemptProvider, attemptModel] of attempts) {
    const found = modelRegistry.find(attemptProvider, attemptModel);
    const contextWindow = found?.contextWindow;
    if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
      return contextWindow;
    }
  }

  return undefined;
}

export function registerForkTool(pi: ExtensionAPI): void {
  if (process.env[PI_SUBAGENT_CHILD_ENV] === "1") return;

  pi.registerTool({
    name: "fork",
    label: "Fork",
    description: FORK_TOOL_TEXT.description,
    promptSnippet: FORK_TOOL_TEXT.promptSnippet,
    promptGuidelines: [...FORK_TOOL_TEXT.promptGuidelines],
    executionMode: "parallel",
    parameters: ForkParams,
    renderCall: renderForkCall,
    renderResult: renderForkResult,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const config = loadConfig(ctx.cwd).fork;
      const effort = resolveEffortState(params.effort, config);
      const result = await runFork({
        cwd: ctx.cwd,
        task: params.task,
        config,
        effort,
        writeSessionSnapshot: (filePath) => writeForkSessionSnapshotJsonl(ctx.sessionManager, filePath),
        signal,
        onUpdate,
        makeDetails,
        resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
      });

      recordForkUsage(pi, result);

      if (isResultError(result)) {
        return {
          content: [
            {
              type: "text" as const,
              text: formatResultContent(result, true),
            },
          ],
          details: makeDetails([result]),
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: formatResultContent(result, false) }],
        details: makeDetails([result]),
      };
    },
  });
}
