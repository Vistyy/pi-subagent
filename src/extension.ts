import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { type AgentConfig, discoverAgents, formatAgentList } from "./agents.js";
import { getResultSummaryText } from "./child-events/index.js";
import { loadConfig, type SubagentConfig } from "./config.js";
import { emptyUsage, isResultError, type SubagentDetails, type SubagentResult } from "./core/types.js";
import { runSubagent } from "./runner/index.js";
import { renderSubagentCall, renderSubagentResult } from "./ui/render.js";
import { buildUsageRecordedData, PI_USAGE_RECORDED } from "./usage.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

type AgentDirs = SubagentDetails["agentDirs"];

const TaskItemSchema = Type.Object({
  agent: Type.String({ description: "Defined agent identity to run" }),
  task: Type.String({ description: "Task for that identity" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this agent process" })),
});

const ChainItemSchema = Type.Object({
  agent: Type.String({ description: "Defined agent identity to run" }),
  task: Type.String({ description: "Task. May include {previous} to include prior output." }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this agent process" })),
});

const SubagentParamsSchema = Type.Object({
  agent: Type.Optional(Type.String({ description: "Defined agent identity for single-agent mode" })),
  task: Type.Optional(Type.String({ description: "Task for single-agent mode" })),
  tasks: Type.Optional(Type.Array(TaskItemSchema, { description: "Parallel tasks using defined identities" })),
  chain: Type.Optional(Type.Array(ChainItemSchema, { description: "Sequential tasks using defined identities" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for single-agent mode" })),
});

type SubagentParams = Static<typeof SubagentParamsSchema>;
type TaskItem = Static<typeof TaskItemSchema>;

function makeDetails(mode: SubagentDetails["mode"], agentDirs: AgentDirs, results: SubagentResult[]): SubagentDetails {
  return { mode, agentDirs, results };
}

function textResult(
  text: string,
  mode: SubagentDetails["mode"],
  agentDirs: AgentDirs,
  results: SubagentResult[] = [],
  isError = false,
): AgentToolResult<SubagentDetails> {
  return {
    content: [{ type: "text", text }],
    details: makeDetails(mode, agentDirs, results),
    ...(isError ? { isError: true } : {}),
  };
}

function availableIdentitiesMessage(agentDirs: AgentDirs, agents: AgentConfig[]): string {
  return [
    `User identities: ${agentDirs.user}`,
    `Project identities: ${agentDirs.project} (${agentDirs.projectTrusted ? "trusted" : "ignored until project is trusted"})`,
    `Available identities: ${formatAgentList(agents)}.`,
  ].join("\n");
}

function getRequestedAgentNames(params: SubagentParams): string[] {
  const names: string[] = [];
  if (params.agent) names.push(params.agent);
  for (const task of params.tasks ?? []) names.push(task.agent);
  for (const step of params.chain ?? []) names.push(step.agent);
  return names;
}

function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((candidate) => candidate.name === name);
}

function unknownAgentMessage(name: string, agents: AgentConfig[]): string {
  return `Unknown subagent identity "${name}". Available identities: ${formatAgentList(agents)}.`;
}

function validateRequestedAgents(params: SubagentParams, agents: AgentConfig[]): string | undefined {
  for (const name of getRequestedAgentNames(params)) {
    if (!findAgent(agents, name)) return unknownAgentMessage(name, agents);
  }
  return undefined;
}

function getModeCount(params: SubagentParams): number {
  const hasChain = (params.chain?.length ?? 0) > 0;
  const hasTasks = (params.tasks?.length ?? 0) > 0;
  const hasSingle = Boolean(params.agent && params.task);
  return Number(hasChain) + Number(hasTasks) + Number(hasSingle);
}

function createPlaceholderResult(agentName: string, task: string): SubagentResult {
  return {
    agent: agentName,
    agentSource: "unknown",
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
  };
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];

  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = new Array(workerCount).fill(null).map(async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function formatSubagentSection(result: SubagentResult): string {
  const status = isResultError(result) ? "failed" : "completed";
  return `### ${result.agent} (${result.agentSource}) ${status}\n\n${getResultSummaryText(result)}`;
}

function formatResultsContent(results: SubagentResult[]): string {
  if (results.length === 1) return getResultSummaryText(results[0]);
  return results.map(formatSubagentSection).join("\n\n---\n\n");
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

function recordSubagentUsage(pi: ExtensionAPI, result: SubagentResult, mode: SubagentDetails["mode"]): void {
  const totalTokens = result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheWrite;
  if (totalTokens === 0 && result.usage.cost === 0) return;

  pi.appendEntry(PI_USAGE_RECORDED, buildUsageRecordedData({
    extension: "subagent",
    agent: result.agent,
    operation: mode === "invalid" ? "subagent" : mode,
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

function recordSubagentUsages(pi: ExtensionAPI, results: SubagentResult[], mode: SubagentDetails["mode"]): void {
  for (const result of results) recordSubagentUsage(pi, result, mode);
}

async function runSingle(
  params: SubagentParams,
  agents: AgentConfig[],
  agentDirs: AgentDirs,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: SubagentConfig,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<SubagentDetails>) => void) | undefined,
): Promise<AgentToolResult<SubagentDetails>> {
  if (!params.agent || !params.task) return textResult("Invalid single subagent parameters.", "single", agentDirs, [], true);

  const agent = findAgent(agents, params.agent);
  if (!agent) return textResult(unknownAgentMessage(params.agent, agents), "single", agentDirs, [], true);

  const result = await runSubagent({
    cwd: ctx.cwd,
    agent,
    task: params.task,
    childCwd: params.cwd,
    config,
    signal,
    onUpdate,
    makeDetails: (results) => makeDetails("single", agentDirs, results),
    resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
  });

  recordSubagentUsages(pi, [result], "single");
  return textResult(formatResultsContent([result]), "single", agentDirs, [result], isResultError(result));
}

async function runParallel(
  tasks: TaskItem[],
  agents: AgentConfig[],
  agentDirs: AgentDirs,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: SubagentConfig,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<SubagentDetails>) => void) | undefined,
): Promise<AgentToolResult<SubagentDetails>> {
  if (tasks.length > MAX_PARALLEL_TASKS) {
    return textResult(`Too many parallel subagent tasks: ${tasks.length}. Max is ${MAX_PARALLEL_TASKS}.`, "parallel", agentDirs, [], true);
  }

  const currentResults = tasks.map((task) => createPlaceholderResult(task.agent, task.task));

  const results = await mapWithConcurrencyLimit(tasks, MAX_CONCURRENCY, async (task, index) => {
    const agent = findAgent(agents, task.agent);
    if (!agent) {
      const result = createPlaceholderResult(task.agent, task.task);
      result.exitCode = 1;
      result.stderr = unknownAgentMessage(task.agent, agents);
      result.stopReason = "error";
      result.errorMessage = result.stderr;
      currentResults[index] = result;
      return result;
    }

    const result = await runSubagent({
      cwd: ctx.cwd,
      agent,
      task: task.task,
      childCwd: task.cwd,
      config,
      signal,
      onUpdate: onUpdate
        ? (partial) => {
            const updated = partial.details.results[0];
            if (updated) currentResults[index] = updated;
            onUpdate({
              content: [{ type: "text", text: formatResultsContent(currentResults) }],
              details: makeDetails("parallel", agentDirs, currentResults),
            });
          }
        : undefined,
      makeDetails: (results) => makeDetails("parallel", agentDirs, results),
      resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
    });
    currentResults[index] = result;
    return result;
  });

  recordSubagentUsages(pi, results, "parallel");
  const hasError = results.some(isResultError);
  return textResult(formatResultsContent(results), "parallel", agentDirs, results, hasError);
}

async function runChain(
  params: SubagentParams,
  agents: AgentConfig[],
  agentDirs: AgentDirs,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  config: SubagentConfig,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<SubagentDetails>) => void) | undefined,
): Promise<AgentToolResult<SubagentDetails>> {
  const steps = params.chain ?? [];
  const results: SubagentResult[] = [];
  let previousOutput = "";

  for (const step of steps) {
    const agent = findAgent(agents, step.agent);
    if (!agent) return textResult(unknownAgentMessage(step.agent, agents), "chain", agentDirs, results, true);

    const task = step.task.replace(/\{previous\}/g, previousOutput);
    const result = await runSubagent({
      cwd: ctx.cwd,
      agent,
      task,
      childCwd: step.cwd,
      config,
      signal,
      onUpdate: onUpdate
        ? (partial) => {
            const updated = partial.details.results[0];
            onUpdate({
              content: [{ type: "text", text: formatResultsContent([...results, ...(updated ? [updated] : [])]) }],
              details: makeDetails("chain", agentDirs, [...results, ...(updated ? [updated] : [])]),
            });
          }
        : undefined,
      makeDetails: (updatedResults) => makeDetails("chain", agentDirs, updatedResults),
      resolveContextWindow: (provider, model) => resolveModelContextWindow(ctx.modelRegistry, provider, model),
    });

    results.push(result);
    recordSubagentUsage(pi, result, "chain");

    if (isResultError(result)) return textResult(formatResultsContent(results), "chain", agentDirs, results, true);
    previousOutput = getResultSummaryText(result);
  }

  return textResult(formatResultsContent(results), "chain", agentDirs, results, results.some(isResultError));
}

export function registerDefinedSubagents(pi: ExtensionAPI) {
  pi.registerTool<typeof SubagentParamsSchema, SubagentDetails>({
    name: "subagent",
    label: "Subagent",
    description: [
      "Run only pre-defined subagent identities from ~/.pi/agent/agents/*.md or trusted project .pi/agents/*.md.",
      "Use for isolated context and independent analysis.",
      "Trusted project identities override user identities by name.",
      "No ad hoc system prompts or generic agents are supported by this tool.",
      "Child tools and extensions can be configured under the pi-subagent settings key.",
      "Modes: single (agent + task), parallel (tasks array), or chain (sequential with {previous}).",
    ].join(" "),
    executionMode: "parallel",
    parameters: SubagentParamsSchema,
    renderCall: renderSubagentCall,
    renderResult: renderSubagentResult,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const projectTrusted = ctx.isProjectTrusted();
      const { agents, userAgentsDir, projectAgentsDir } = discoverAgents({ cwd: ctx.cwd, projectTrusted });
      const agentDirs = { user: userAgentsDir, project: projectAgentsDir, projectTrusted };
      const config = loadConfig(ctx.cwd);

      if (getModeCount(params) !== 1) {
        return textResult(`Provide exactly one subagent mode.\n${availableIdentitiesMessage(agentDirs, agents)}`, "invalid", agentDirs, [], true);
      }

      const validationError = validateRequestedAgents(params, agents);
      if (validationError) return textResult(validationError, "invalid", agentDirs, [], true);

      if (params.chain && params.chain.length > 0) {
        return runChain(params, agents, agentDirs, pi, ctx, config, signal, onUpdate);
      }

      if (params.tasks && params.tasks.length > 0) {
        return runParallel(params.tasks, agents, agentDirs, pi, ctx, config, signal, onUpdate);
      }

      return runSingle(params, agents, agentDirs, pi, ctx, config, signal, onUpdate);
    },
  });
}
