import { describe, expect, it } from "vitest";
import { parseInheritedCliArgs } from "../src/fork/runner/cli.js";

describe("parseInheritedCliArgs", () => {
  it("inherits only selected runtime flags", () => {
    const parsed = parseInheritedCliArgs([
      "node", "pi",
      "--mode", "json",
      "--session", "parent.jsonl",
      "--provider", "openai-codex",
      "--model", "gpt-5.5",
      "--thinking", "high",
      "--tools", "read,bash",
      "--verbose",
      "--unknown", "value",
    ]);

    expect(parsed).toEqual({
      alwaysProxy: ["--provider", "openai-codex"],
      fallbackModel: "gpt-5.5",
      fallbackThinking: "high",
      fallbackTools: "read,bash",
      fallbackNoTools: false,
    });
  });
});
