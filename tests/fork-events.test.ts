import { describe, expect, it } from "vitest";
import { getChildProgressText, getResultSummaryText, processPiJsonLine } from "../src/child-events/index.js";
import { emptyUsage, type ForkResult } from "../src/core/types.js";

function result(): ForkResult {
  return {
    task: "task",
    effort: { selected: "balanced", source: "default" },
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
  };
}

describe("runner event parsing", () => {
  it("captures final assistant text and usage from message_end", () => {
    const r = result();
    const changed = processPiJsonLine(JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        provider: "p",
        model: "m",
        content: [{ type: "text", text: "done" }],
        usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.2 }, totalTokens: 18 },
      },
    }), r);

    expect(changed).toBe(true);
    expect(getResultSummaryText(r)).toBe("done");
    expect(r.provider).toBe("p");
    expect(r.model).toBe("m");
    expect(r.usage).toMatchObject({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.2, turns: 1 });
  });

  it("tracks tool activity in one compact activities list", () => {
    const r = result();

    processPiJsonLine(JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: { path: "src/index.ts" },
    }), r);
    processPiJsonLine(JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { content: [{ type: "text", text: "file contents" }] },
    }), r);

    expect(r.activities).toEqual([
      expect.objectContaining({
        type: "tool",
        toolCallId: "call-1",
        toolName: "read",
        status: "completed",
        displayText: "read src/index.ts",
      }),
    ]);
    expect("toolExecutions" in r).toBe(false);
  });

  it("shows thinking progress with chunk counts", () => {
    const r = result();

    processPiJsonLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_start" },
    }), r);
    processPiJsonLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta" },
    }), r);
    processPiJsonLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta" },
    }), r);
    processPiJsonLine(JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_end" },
    }), r);

    expect(r.activities).toEqual([
      expect.objectContaining({
        type: "thinking",
        status: "completed",
        deltaCount: 2,
      }),
    ]);
    expect(getChildProgressText(r)).toBe("✓ thinking (2 chunks)");
  });

  it("ignores malformed JSON lines", () => {
    const r = result();
    expect(processPiJsonLine("not json", r)).toBe(false);
    expect(r.messages).toEqual([]);
  });
});
