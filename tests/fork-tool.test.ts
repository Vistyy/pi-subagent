import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunFork = vi.hoisted(() => vi.fn());

vi.mock("../src/fork/runner/index.js", () => ({ runFork: mockRunFork }));
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      fork: {
        extensions: [],
        environment: {},
        activation: null,
        tools: null,
        offline: true,
        sandbox: { bashNetwork: false, tmpDir: "/tmp" },
        costFooter: true,
        defaultEffort: "balanced",
      },
      subagent: { extensions: [], environment: {}, offline: true },
    }),
  };
});

import { PI_SUBAGENT_CHILD_ENV } from "../src/runner/env.js";
import { PI_USAGE_RECORDED } from "../src/usage.js";
import { registerForkTool } from "../src/fork/tool.js";

let originalChildEnv: string | undefined;

beforeEach(() => {
  originalChildEnv = process.env[PI_SUBAGENT_CHILD_ENV];
  delete process.env[PI_SUBAGENT_CHILD_ENV];
});

afterEach(() => {
  if (originalChildEnv === undefined) delete process.env[PI_SUBAGENT_CHILD_ENV];
  else process.env[PI_SUBAGENT_CHILD_ENV] = originalChildEnv;
});

describe("fork tool registration", () => {
  it("does not register inside a child process", () => {
    process.env[PI_SUBAGENT_CHILD_ENV] = "1";
    const pi = { appendEntry: vi.fn(), registerTool: vi.fn() } as any;

    registerForkTool(pi);

    expect(pi.registerTool).not.toHaveBeenCalled();
  });
});

describe("fork tool execution", () => {
  it("uses balanced effort when omitted and records usage", async () => {
    let execute: any;
    const appendEntry = vi.fn();
    const pi = {
      appendEntry,
      registerTool: vi.fn((tool) => { execute = tool.execute; }),
    } as any;
    registerForkTool(pi);
    mockRunFork.mockResolvedValueOnce({
      task: "investigate",
      exitCode: 0,
      messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }],
      stderr: "",
      usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, cost: 0.25, contextTokens: 20, turns: 1 },
      provider: "anthropic",
      model: "claude",
      stopReason: "stop",
      sawAgentEnd: true,
      effort: { selected: "balanced", source: "default" },
    });

    await execute("call-1", { task: "investigate" }, undefined, undefined, {
      cwd: "/tmp/project",
      isProjectTrusted: () => false,
      modelRegistry: { find: vi.fn() },
      sessionManager: { getHeader: () => ({ type: "header" }), buildSessionContext: () => ({ messages: [] }) },
    });

    expect(mockRunFork).toHaveBeenCalledWith(expect.objectContaining({
      effort: { selected: "balanced", source: "default" },
      writeSessionSnapshot: expect.any(Function),
    }));
    expect(appendEntry).toHaveBeenCalledWith(PI_USAGE_RECORDED, expect.objectContaining({
      extension: "fork",
      agent: "child-agent",
      operation: "fork",
      tags: { effort: "balanced" },
      usage: expect.objectContaining({ input: 10, output: 5, cacheRead: 3, cacheWrite: 2, totalTokens: 20, cost: 0.25 }),
    }));
  });
});
