import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { type AgentConfig, discoverAgents, formatAgentList } from "./agents.js";
import { getResultSummaryText } from "./child-events/index.js";
import { loadConfig } from "./config.js";
import { isResultError, type SubagentDetails, type SubagentResult } from "./core/types.js";
import { PI_SUBAGENT_CHILD_ENV } from "./runner/env.js";
import { resolveModelContextWindow } from "./runner/index.js";
import { runSubagent } from "./subagent-runner.js";
import { renderSubagentCall, renderSubagentResult } from "./ui/render.js";
import { recordChildUsage } from "./usage.js";

const SubagentParamsSchema = Type.Object({
  agent: Type.String({ description: "Defined agent identity to run" }),
  task: Type.String({ description: "Complete self-contained task for that identity" }),
});

export type SubagentParams = Static<typeof SubagentParamsSchema>;

function makeDetails(results: SubagentResult[]): SubagentDetails {
  return { results };
}

function textResult(
  text: string,
  results: SubagentResult[] = [],
  isError = false,
): AgentToolResult<SubagentDetails> {
  return {
    content: [{ type: "text", text }],
    details: makeDetails(results),
    ...(isError ? { isError: true } : {}),
  };
}

function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((candidate) => candidate.name === name);
}

function unknownAgentMessage(name: string, agents: AgentConfig[]): string {
  return `Unknown subagent identity "${name}". Available identities: ${formatAgentList(agents)}.`;
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
      const { agents } = discoverAgents({ cwd: ctx.cwd, projectTrusted });
      const agent = findAgent(agents, params.agent);
      if (!agent) return textResult(unknownAgentMessage(params.agent, agents), [], true);

      const config = loadConfig(ctx.cwd, projectTrusted).subagent;
      const result = await runSubagent({
        cwd: ctx.cwd,
        agent,
        task: params.task,
        config,
        signal,
        onUpdate,
        makeDetails,
        resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
      });

      recordChildUsage(pi, result, {
        extension: "subagent",
        agent: result.agent,
        operation: "subagent",
        tags: { source: result.agentSource },
      });
      return textResult(getResultSummaryText(result), [result], isResultError(result));
    },
  });
}
