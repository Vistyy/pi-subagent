import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

function tempDir(name: string): string {
  const dir = join(tmpdir(), `pi-subagent-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pi-subagent configuration", () => {
  it("defaults Fork to balanced and keeps identity tools authoritative", () => {
    const cwd = tempDir("cwd");
    process.env.PI_CODING_AGENT_DIR = tempDir("agent");

    const config = loadConfig(cwd);

    expect(config.fork.defaultEffort).toBe("balanced");
    expect(config.fork.tools).toBeNull();
    expect(config.subagent).not.toHaveProperty("tools");
  });

  it("keeps Fork and Subagent policies separate under one namespace", () => {
    const cwd = tempDir("cwd");
    const agentDir = tempDir("agent");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeJson(join(agentDir, "settings.json"), {
      "pi-subagent": {
        fork: {
          defaultEffort: "fast",
          tools: "read,bash",
          extensions: ["./fork-extension"],
        },
        subagent: {
          extensions: ["./identity-extension"],
          offline: false,
        },
      },
    });

    const config = loadConfig(cwd);

    expect(config.fork.defaultEffort).toBe("fast");
    expect(config.fork.tools).toBe("read,bash");
    expect(config.fork.extensions).toEqual([join(agentDir, "fork-extension")]);
    expect(config.subagent.extensions).toEqual([join(agentDir, "identity-extension")]);
    expect(config.subagent.offline).toBe(false);
    expect(config.subagent).not.toHaveProperty("tools");
  });

  it("merges trusted project overrides independently for each child kind", () => {
    const cwd = tempDir("cwd");
    const agentDir = tempDir("agent");
    const projectSettingsDir = join(cwd, ".pi");
    mkdirSync(projectSettingsDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    writeJson(join(agentDir, "settings.json"), {
      "pi-subagent": {
        fork: {
          environment: { A: "global", B: "global" },
          sandbox: { bashNetwork: true },
          effortProfiles: {
            fast: { provider: "openai-codex", id: "fast", thinking: "low" },
          },
        },
        subagent: { environment: { C: "global" } },
      },
    });
    writeJson(join(projectSettingsDir, "settings.json"), {
      "pi-subagent": {
        fork: {
          environment: { B: "project" },
          sandbox: { tmpDir: "/tmp/project" },
          effortProfiles: {
            deep: { provider: "openai-codex", id: "deep", thinking: "high" },
          },
        },
        subagent: { environment: { C: "project", D: "project" } },
      },
    });

    const config = loadConfig(cwd);

    expect(config.fork.environment).toEqual({ A: "global", B: "project" });
    expect(config.fork.sandbox).toEqual({ bashNetwork: true, tmpDir: "/tmp/project" });
    expect(config.fork.effortProfiles).toEqual({
      fast: { provider: "openai-codex", id: "fast", thinking: "low" },
      deep: { provider: "openai-codex", id: "deep", thinking: "high" },
    });
    expect(config.subagent.environment).toEqual({ C: "project", D: "project" });
  });
});
