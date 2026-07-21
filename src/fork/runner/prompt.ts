import { pathReportingRules } from "../../core/path-reporting.js";
import type { ForkEffort } from "../../core/types.js";

export interface ForkPromptOptions {
  writableTmpDir?: string;
}

const effortRules: Record<ForkEffort, string> = {
  fast: `Fast effort:
- Inspect the minimum evidence needed for a reliable answer.
- Keep the report brief and focused on the result and decisive evidence.`,
  balanced: `Balanced effort:
- Inspect the directly relevant surfaces needed for a well-supported answer.
- Connect the evidence, material reasoning, trade-offs, and uncertainty.`,
  deep: `Deep effort:
- Pressure-test the answer with wider relevant evidence, counterexamples, failure modes, and hidden assumptions.
- Make confidence limits, blind spots, and unresolved uncertainty explicit.`,
};

function effortPrompt(task: string, effort: ForkEffort): string {
  return `${task}

The delegated task defines the question, scope, and requested output. Preserve them.

Shared rules:
- Investigate only what is relevant to the delegated task.
- Do not modify files, run formatters, or commit unless the task explicitly asks for implementation.
- Ground claims in concrete evidence such as files, symbols, commands, config keys, outputs, or observed behavior.
- Distinguish verified facts, inferences, and unknowns.
- Return a report the parent can act on.

${pathReportingRules}

${effortRules[effort]}
`;
}

function appendForkChildContext(prompt: string): string {
  return `${prompt}
Fork child context:
- You are the forked child agent, not the main session.
- The parent agent delegated this bounded task to you and is waiting for your report.
- Do not continue the parent session's broader work.
- Do not spawn another fork. Forking inside a fork is not allowed.
- Return findings, evidence, caveats, and next steps for the parent to act on.
`;
}

function appendRuntimeNotes(prompt: string, options: ForkPromptOptions): string {
  if (!options.writableTmpDir) return prompt;
  return `${prompt}
Runtime notes:
- Your writable temp directory is: ${options.writableTmpDir}.
- Use it proactively for scratch files, downloads, clones, caches, extracted pages, and quick experiments.
- Before using web_search, web_fetch, or fetching/cloning from the network, check whether the needed artifact is already available in the workspace or writable temp directory.
- Prefer local workspace and temp artifacts over network access when they are available and relevant.
- Put any newly downloaded, cloned, generated, or extracted material there so later steps in this fork can reuse it.
`;
}

export function buildForkTaskPrompt(
  task: string,
  effort: ForkEffort = "balanced",
  options: ForkPromptOptions = {},
): string {
  return appendRuntimeNotes(appendForkChildContext(effortPrompt(task, effort)), options);
}
