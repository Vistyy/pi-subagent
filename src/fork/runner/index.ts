import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { ForkConfig } from "../../config.js";
import {
  emptyUsage,
  type ForkDetails,
  type ForkEffort,
  type ForkEffortProfile,
  type ForkEffortState,
  type ForkResult,
} from "../../core/types.js";
import {
  PI_SUBAGENT_FORK_SANDBOX_HOST_TMPDIR_ENV,
  PI_SUBAGENT_FORK_SANDBOX_TMPDIR_ENV,
} from "../../runner/env.js";
import { type ContextWindowResolver, runChild } from "../../runner/index.js";
import { parseInheritedCliArgs } from "./cli.js";
import { buildForkTaskPrompt } from "./prompt.js";

const inheritedCliArgs = parseInheritedCliArgs(process.argv);

type InheritedCliArgs = ReturnType<typeof parseInheritedCliArgs>;

export function buildForkArgs(
  task: string,
  sessionPath: string,
  extensions: string[] | null,
  effortProfile?: ForkEffortProfile,
  inherited: InheritedCliArgs = inheritedCliArgs,
  effort: ForkEffort = "balanced",
  tools?: string | null,
  writableTmpDir?: string,
): string[] {
  const args: string[] = ["--mode", "json", ...inherited.alwaysProxy, "-p", "--session", sessionPath];

  if (extensions !== null) args.push("--no-extensions");
  if (inherited.fallbackModel) args.push("--model", inherited.fallbackModel);
  if (inherited.fallbackThinking) args.push("--thinking", inherited.fallbackThinking);
  if (effortProfile) {
    args.push("--provider", effortProfile.provider, "--model", effortProfile.id, "--thinking", effortProfile.thinking);
  }
  if (tools !== undefined && tools !== null) {
    if (tools === "") args.push("--no-tools");
    else args.push("--tools", tools);
  } else if (inherited.fallbackTools !== undefined) {
    args.push("--tools", inherited.fallbackTools);
  } else if (inherited.fallbackNoTools) {
    args.push("--no-tools");
  }
  if (extensions !== null) {
    for (const extension of extensions) args.push("--extension", extension);
  }
  args.push(buildForkTaskPrompt(task, effort, { writableTmpDir }));
  return args;
}

export interface RunForkOptions {
  cwd: string;
  task: string;
  config: ForkConfig;
  effort: ForkEffortState;
  writeSessionSnapshot: (filePath: string) => boolean;
  signal?: AbortSignal;
  onUpdate?: (partial: AgentToolResult<ForkDetails>) => void;
  makeDetails: (results: ForkResult[]) => ForkDetails;
  resolveContextWindow?: ContextWindowResolver;
}

export function runFork(options: RunForkOptions): Promise<ForkResult> {
  const {
    cwd,
    task,
    config,
    effort,
    writeSessionSnapshot,
    signal,
    onUpdate,
    makeDetails,
    resolveContextWindow,
  } = options;
  const result: ForkResult = {
    task,
    effort,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
  };

  return runChild({
    kind: "fork",
    cwd,
    result,
    writeSessionSnapshot,
    scratchParent: config.sandbox.tmpDir,
    buildArgs: ({ sessionPath, scratchDir }) => {
      if (!sessionPath) throw new Error("Cannot fork: missing parent session snapshot context.");
      return buildForkArgs(
        task,
        sessionPath,
        config.extensions,
        effort.profile,
        inheritedCliArgs,
        effort.selected,
        config.tools,
        scratchDir,
      );
    },
    environment: ({ scratchDir }) => ({
      ...config.environment,
      ...(scratchDir
        ? {
            [PI_SUBAGENT_FORK_SANDBOX_HOST_TMPDIR_ENV]: scratchDir,
            [PI_SUBAGENT_FORK_SANDBOX_TMPDIR_ENV]: scratchDir,
          }
        : {}),
    }),
    activation: config.activation,
    offline: config.offline,
    signal,
    onUpdate,
    makeDetails,
    resolveContextWindow,
  });
}
