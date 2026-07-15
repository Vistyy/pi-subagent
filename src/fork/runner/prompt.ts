import type { ForkEffort } from "../../core/types.js";
import { effortPrompt } from "./prompts/index.js";

export interface ForkPromptOptions {
  writableTmpDir?: string;
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
  const prompt = effortPrompt(task, effort);
  return appendRuntimeNotes(appendForkChildContext(prompt), options);
}
