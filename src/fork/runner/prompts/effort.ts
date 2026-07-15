import type { ForkEffort } from "../../../core/types.js";

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

export function effortPrompt(task: string, effort: ForkEffort): string {
  return `${task}

The delegated task defines the question, scope, and requested output. Preserve them.

Shared rules:
- Investigate only what is relevant to the delegated task.
- Do not modify files, run formatters, or commit unless the task explicitly asks for implementation.
- Ground claims in concrete evidence such as files, symbols, commands, config keys, outputs, or observed behavior.
- Distinguish verified facts, inferences, and unknowns.
- Return a report the parent can act on.

${effortRules[effort]}
`;
}
