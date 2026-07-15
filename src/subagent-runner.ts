import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./agents.js";
import type { SubagentConfig } from "./config.js";
import { emptyUsage, type SubagentDetails, type SubagentResult } from "./core/types.js";
import { type ContextWindowResolver, runChild } from "./runner/index.js";

export interface RunSubagentOptions {
  cwd: string;
  agent: AgentConfig;
  task: string;
  config: SubagentConfig;
  signal?: AbortSignal;
  onUpdate?: (partial: AgentToolResult<SubagentDetails>) => void;
  makeDetails: (results: SubagentResult[]) => SubagentDetails;
  resolveContextWindow?: ContextWindowResolver;
}

function parseModel(model: string | undefined): { provider?: string; id?: string } {
  const trimmed = model?.trim();
  if (!trimmed) return {};
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
    return { provider: trimmed.slice(0, slashIndex), id: trimmed.slice(slashIndex + 1) };
  }
  return { id: trimmed };
}

export function buildSubagentArgs(
  agent: AgentConfig,
  task: string,
  systemPromptPath: string | undefined,
  config: SubagentConfig,
): string[] {
  const configuredTools = Object.prototype.hasOwnProperty.call(config, "tools") ? config.tools : undefined;
  const toolAllowlist = configuredTools === undefined ? agent.tools.join(",") : configuredTools;
  const args = ["--mode", "json", "-p", "--no-session", "--no-skills", "--no-prompt-templates"];

  if (config.extensions !== null) args.push("--no-extensions");
  if (toolAllowlist !== null) {
    if (toolAllowlist === "") args.push("--no-tools");
    else args.push("--tools", toolAllowlist);
  }
  if (agent.model) args.push("--model", agent.model);
  if (agent.thinking) args.push("--thinking", agent.thinking);
  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
  if (config.extensions !== null) {
    for (const extension of config.extensions) args.push("--extension", extension);
  }
  args.push(`Task: ${task}`);
  return args;
}

export function runSubagent(options: RunSubagentOptions): Promise<SubagentResult> {
  const { cwd, agent, task, config, signal, onUpdate, makeDetails, resolveContextWindow } = options;
  const parsedModel = parseModel(agent.model);
  const result: SubagentResult = {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    provider: parsedModel.provider,
    model: parsedModel.id,
  };

  return runChild({
    kind: "subagent",
    cwd,
    result,
    systemPrompt: agent.systemPrompt,
    buildArgs: ({ systemPromptPath }) => buildSubagentArgs(agent, task, systemPromptPath, config),
    environment: config.environment,
    offline: config.offline,
    signal,
    onUpdate,
    makeDetails,
    resolveContextWindow,
  });
}
