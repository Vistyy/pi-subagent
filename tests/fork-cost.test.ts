import { describe, expect, it } from "vitest";
import { aggregateInclusiveCost, formatForkCostStatus } from "../src/fork/core/cost.js";

describe("fork cost aggregation", () => {
  it("separates main and fork usage", () => {
    const stats = aggregateInclusiveCost([
      {
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: { total: 0.1 }, totalTokens: 18 },
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "fork",
          details: {
            results: [{ usage: { input: 20, output: 10, cacheRead: 4, cacheWrite: 2, cost: 0.25, contextTokens: 36, turns: 2 } }],
          },
        },
      },
    ]);

    expect(stats.main.cost).toBe(0.1);
    expect(stats.forks.cost).toBe(0.25);
    expect(stats.total.cost).toBe(0.35);
    expect(stats.forkResults).toBe(1);
  });

  it("formats only non-zero fork cost", () => {
    expect(formatForkCostStatus({
      main: zero(),
      forks: { ...zero(), cost: 0.1234 },
      total: zero(),
      forkResults: 1,
    })).toBe("forks +$0.123");

    expect(formatForkCostStatus({ main: zero(), forks: zero(), total: zero(), forkResults: 0 })).toBeUndefined();
  });
});

function zero() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}
