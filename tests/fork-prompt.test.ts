import { describe, expect, it } from "vitest";
import { buildForkTaskPrompt } from "../src/fork/runner/prompt.js";

const commonContract = [
  "The delegated task defines the question, scope, and requested output. Preserve them.",
  "Investigate only what is relevant to the delegated task.",
  "Distinguish verified facts, inferences, and unknowns.",
  "Return a report the parent can act on.",
];

describe("buildForkTaskPrompt", () => {
  it.each([
    ["fast", "Inspect the minimum evidence needed for a reliable answer."],
    ["balanced", "Inspect the directly relevant surfaces needed for a well-supported answer."],
    ["deep", "Pressure-test the answer with wider relevant evidence"],
  ] as const)("preserves the shared task contract at %s effort", (effort, effortRule) => {
    const prompt = buildForkTaskPrompt("Answer this exact question.", effort);

    expect(prompt).toContain("Answer this exact question.");
    for (const rule of commonContract) expect(prompt).toContain(rule);
    expect(prompt).toContain(effortRule);
  });
});
