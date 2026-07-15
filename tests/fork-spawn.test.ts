import { describe, expect, it } from "vitest";
import { resolvePiSpawn } from "../src/runner/index.js";

function withPiCommand(value: string | undefined, fn: () => void): void {
  const previous = process.env.PI_SUBAGENT_PI_COMMAND;
  if (value === undefined) delete process.env.PI_SUBAGENT_PI_COMMAND;
  else process.env.PI_SUBAGENT_PI_COMMAND = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_PI_COMMAND;
    else process.env.PI_SUBAGENT_PI_COMMAND = previous;
  }
}

describe("resolvePiSpawn", () => {
  it("spawns pi by default instead of guessing argv[1]", () => {
    withPiCommand(undefined, () => {
      expect(resolvePiSpawn()).toEqual({ command: "pi", prefixArgs: [] });
    });
  });

  it("allows command override through PI_SUBAGENT_PI_COMMAND", () => {
    withPiCommand("/custom/pi", () => {
      expect(resolvePiSpawn()).toEqual({ command: "/custom/pi", prefixArgs: [] });
    });
  });

  it("wraps default pi command with activation", () => {
    withPiCommand(undefined, () => {
      expect(resolvePiSpawn("/repo", { command: "direnv", args: ["exec", "{cwd}"] })).toEqual({
        command: "direnv",
        prefixArgs: ["exec", "/repo", "pi"],
      });
    });
  });

  it("wraps PI_SUBAGENT_PI_COMMAND with activation", () => {
    withPiCommand("/custom/pi", () => {
      expect(resolvePiSpawn("/repo", { command: "direnv", args: ["exec", "{cwd}"] })).toEqual({
        command: "direnv",
        prefixArgs: ["exec", "/repo", "/custom/pi"],
      });
    });
  });
});
