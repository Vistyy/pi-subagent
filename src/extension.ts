import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { type AgentConfig, discoverAgents, formatAgentList } from "./agents.js";
import { getResultSummaryText } from "./child-events/index.js";
import { loadConfig } from "./config.js";
import { isResultError, type SubagentDetails, type SubagentResult } from "./core/types.js";
import { PI_SUBAGENT_CHILD_ENV } from "./runner/env.js";
import { runSubagent } from "./subagent-runner.js";
import { renderSubagentCall, renderSubagentResult } from "./ui/render.js";
import { buildUsageRecordedData, PI_USAGE_RECORDED } from "./usage.js";

const SubagentParamsSchema = Type.Object({
  agent: Type.String({ description: "Defined agent identity to run" }),
  task: Type.String({ description: "Complete self-contained task for that identity" }),
});

export type SubagentParams = Static<typeof SubagentParamsSchema>;
type AgentDirs = SubagentDetails["agentDirs"];

function makeDetails(agentDirs: AgentDirs, results: SubagentResult[]): SubagentDetails {
  return { agentDirs, results };
}

function textResult(
  text: string,
  agentDirs: AgentDirs,
  results: SubagentResult[] = [],
  isError = false,
): AgentToolResult<SubagentDetails> {
  return {
    content: [{ type: "text", text }],
    details: makeDetails(agentDirs, results),
    ...(isError ? { isError: true } : {}),
  };
}

function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((candidate) => candidate.name === name);
}

function unknownAgentMessage(name: string, agents: AgentConfig[]): string {
  return `Unknown subagent identity "${name}". Available identities: ${formatAgentList(agents)}.`;
}

function resolveModelContextWindow(
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
    if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) return contextWindow;
  }
  return undefined;
}

function recordSubagentUsage(pi: ExtensionAPI, result: SubagentResult): void {
  const totalTokens = result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite;
  if (totalTokens === 0 && result.usage.cost === 0) return;

  pi.appendEntry(PI_USAGE_RECORDED, buildUsageRecordedData({
    extension: "subagent",
    agent: result.agent,
    operation: "subagent",
    tags: { source: result.agentSource },
    model: { provider: result.provider, id: result.model },
    usage: {
      input: result.usage.input,
      output: result.usage.output,
      cacheRead: result.usage.cacheRead,
      cacheWrite: result.usage.cacheWrite,
      totalTokens,
      cost: result.usage.cost,
    },
  }));
}

export function registerDefinedSubagents(pi: ExtensionAPI): void {
  if (process.env[PI_SUBAGENT_CHILD_ENV] === "1") return;

  pi.registerTool<typeof SubagentParamsSchema, SubagentDetails>({
    name: "subagent",
    label: "Subagent",
    description: [
      "Run one predefined identity from ~/.pi/agent/agents/*.md or trusted project .pi/agents/*.md.",
      "The task is self-contained and does not inherit the parent conversation.",
      "Use separate subagent calls when independent identities should run in parallel.",
      "No ad hoc system prompts or generic agents are supported.",
    ].join(" "),
    executionMode: "parallel",
    parameters: SubagentParamsSchema,
    renderCall: renderSubagentCall,
    renderResult: renderSubagentResult,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const projectTrusted = ctx.isProjectTrusted();
      const { agents, userAgentsDir, projectAgentsDir } = discoverAgents({ cwd: ctx.cwd, projectTrusted });
      const agentDirs = { user: userAgentsDir, project: projectAgentsDir, projectTrusted };
      const agent = findAgent(agents, params.agent);
      if (!agent) return textResult(unknownAgentMessage(params.agent, agents), agentDirs, [], true);

      const config = loadConfig(ctx.cwd).subagent;
      const result = await runSubagent({
        cwd: ctx.cwd,
        agent,
        task: params.task,
        config,
        signal,
        onUpdate,
        makeDetails: (results) => makeDetails(agentDirs, results),
        resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
      });

      recordSubagentUsage(pi, result);
      return textResult(getResultSummaryText(result), agentDirs, [result], isResultError(result));
    },
  });
}
