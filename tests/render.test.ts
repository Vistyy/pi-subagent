import { describe, expect, it } from "vitest";
import { emptyUsage, type ForkResult, type SubagentResult } from "../src/core/types.js";
import { renderForkResult, renderSubagentResult } from "../src/ui/render.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function rendered(component: { render: (width: number) => string[] }): string {
  return component.render(240).map((line) => line.trimEnd()).join("\n");
}

function forkResult(overrides: Partial<ForkResult> = {}): ForkResult {
  return {
    task: "Smoke test the fork tool",
    effort: { selected: "fast", source: "tool" },
    exitCode: 0,
    messages: [{
      role: "assistant",
      content: [{ type: "text", text: "fork smoke\npassed" }],
      api: "openai-responses",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    }],
    stderr: "",
    usage: {
      ...emptyUsage(),
      input: 11_000,
      output: 391,
      cacheRead: 9_200,
      cost: 0.0144,
      contextTokens: 5_580,
      contextWindow: 372_000,
      turns: 4,
    },
    durationMs: 18_000,
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    stopReason: "stop",
    sawAgentEnd: true,
    activities: [
      { type: "thinking", status: "completed" },
      { type: "tool", toolCallId: "1", toolName: "read", displayText: "read package.json", status: "completed" },
    ],
    ...overrides,
  };
}

describe("collapsed delegation rendering", () => {
  it("renders a completed fork with bounded activity and its child footer", () => {
    const text = rendered(renderForkResult(
      { details: { results: [forkResult()] }, content: [] },
      { expanded: false },
      theme,
    ));

    expect(text).toContain("✓ completed");
    expect(text).not.toContain("✓ fork completed");
    expect(text).toContain("✓ thinking");
    expect(text).toContain("✓ read package.json");
    expect(text).toContain("18s · 4 turns ↑11k ↓391 R9.2k $0.0144 1.5%/372k (openai-codex) gpt-5.6-luna");
    expect(text).not.toContain("fork smoke passed");
    expect(text).not.toContain("expand");
  });

  it("renders a completed named subagent with output and its child footer", () => {
    const result: SubagentResult = {
      ...forkResult(),
      agent: "interface-designer",
      agentSource: "user",
      activities: [],
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "subagent smoke passed" }],
        api: "openai-responses",
        provider: "openai-codex",
        model: "gpt-5.6-luna",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      }],
    };
    const text = rendered(renderSubagentResult(
      { details: { results: [result] }, content: [] },
      { expanded: false },
      theme,
    ));

    expect(text).toContain("✓ completed");
    expect(text).not.toContain("interface-designer");
    expect(text).not.toContain("user");
    expect(text).toContain("subagent smoke passed");
    expect(text).toContain("18s · 4 turns");
  });

  it("shows only the latest activity while running", () => {
    const result = forkResult({
      exitCode: -1,
      messages: [],
      sawAgentEnd: false,
      activities: [
        { type: "tool", toolCallId: "1", toolName: "read", displayText: "read first.ts", status: "completed" },
        { type: "tool", toolCallId: "2", toolName: "read", displayText: "read second.ts", status: "completed" },
        { type: "tool", toolCallId: "3", toolName: "read", displayText: "read third.ts", status: "completed" },
        { type: "tool", toolCallId: "4", toolName: "read", displayText: "read current.ts", status: "completed" },
        { type: "thinking", status: "running" },
      ],
    });
    const text = rendered(renderForkResult(
      { details: { results: [result] }, content: [] },
      { expanded: false },
      theme,
    ));

    expect(text).toContain("… 2 earlier activities");
    expect(text).toContain("✓ read third.ts");
    expect(text).toContain("✓ read current.ts");
    expect(text).toContain("… thinking...");
    expect(text).not.toContain("first.ts");
    expect(text).not.toContain("second.ts");
    expect(text).toContain("18s · 4 turns");
  });

  it("keeps full detail in the expanded view", () => {
    const result = forkResult({
      exitCode: 1,
      stopReason: "error",
      errorMessage: "failed clearly",
      retry: { success: false },
    });
    const text = rendered(renderForkResult(
      { details: { results: [result] }, content: [] },
      { expanded: true },
      theme,
    ));

    expect(text).toContain("--- Task ---");
    expect(text).toContain("--- Activity ---");
    expect(text).toContain("--- Output ---");
    expect(text).toContain("--- Error ---");
    expect(text).toContain("failed clearly");
    expect(text).toContain("$0.0144");
    expect(text).toContain("openai-codex");
  });
});
