import { afterEach, describe, expect, it, vi } from "vitest";
import piSubagent from "../index.js";
import { PI_SUBAGENT_CHILD_ENV } from "../src/runner/env.js";

const originalChild = process.env[PI_SUBAGENT_CHILD_ENV];

afterEach(() => {
  if (originalChild === undefined) delete process.env[PI_SUBAGENT_CHILD_ENV];
  else process.env[PI_SUBAGENT_CHILD_ENV] = originalChild;
});

describe("pi-subagent package interface", () => {
  it("registers exactly one fork and one single-child subagent tool", () => {
    delete process.env[PI_SUBAGENT_CHILD_ENV];
    const tools: any[] = [];
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool) => tools.push(tool)),
    } as any;

    piSubagent(pi);

    expect(tools.map((tool) => tool.name)).toEqual(["fork", "subagent"]);
    const fork = tools[0];
    const subagent = tools[1];
    expect(Object.keys(fork.parameters.properties)).toEqual(["task", "effort"]);
    expect(fork.parameters.required).toEqual(["task"]);
    expect(Object.keys(subagent.parameters.properties)).toEqual(["agent", "task"]);
    expect(subagent.parameters.required).toEqual(["agent", "task"]);
    expect(subagent.executionMode).toBe("parallel");
  });

  it("registers no delegation tools inside either child kind", () => {
    process.env[PI_SUBAGENT_CHILD_ENV] = "1";
    const pi = { on: vi.fn(), registerTool: vi.fn() } as any;

    piSubagent(pi);

    expect(pi.registerTool).not.toHaveBeenCalled();
  });
});
