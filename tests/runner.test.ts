import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../src/agents.js";
import { buildSubagentArgs, runSubagent } from "../src/subagent-runner.js";

const tempDirs: string[] = [];
const originalCommand = process.env.PI_SUBAGENT_PI_COMMAND;
const originalOffline = process.env.PI_OFFLINE;
const originalArgFile = process.env.PI_SUBAGENT_ARG_FILE;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-runner-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(dir: string, body: string): string {
  const filePath = path.join(dir, "fake-pi.js");
  fs.writeFileSync(filePath, `#!/usr/bin/env node\n${body}`, "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

function agent(): AgentConfig {
  return {
    name: "interface-designer",
    description: "Designs one interface.",
    tools: ["read", "grep"],
    model: "openai-codex/gpt-5.4-mini",
    thinking: "medium",
    systemPrompt: "Design one interface.",
    filePath: "/tmp/interface-designer.md",
    source: "user",
  };
}

afterEach(() => {
  if (originalCommand === undefined) delete process.env.PI_SUBAGENT_PI_COMMAND;
  else process.env.PI_SUBAGENT_PI_COMMAND = originalCommand;
  if (originalOffline === undefined) delete process.env.PI_OFFLINE;
  else process.env.PI_OFFLINE = originalOffline;
  if (originalArgFile === undefined) delete process.env.PI_SUBAGENT_ARG_FILE;
  else process.env.PI_SUBAGENT_ARG_FILE = originalArgFile;

  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildSubagentArgs", () => {
  it("uses identity tools and disables child extensions by default", () => {
    expect(buildSubagentArgs(agent(), "Design a seam.", "/tmp/prompt.md", { extensions: [], environment: {}, offline: true })).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--no-extensions",
      "--tools",
      "read,grep",
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "--append-system-prompt",
      "/tmp/prompt.md",
      "Task: Design a seam.",
    ]);
  });

  it("uses configured tools and extensions when provided", () => {
    expect(
      buildSubagentArgs(agent(), "Design a seam.", undefined, {
        extensions: ["/tmp/child-extension.ts"],
        environment: {},
        tools: "bash,read",
        offline: true,
      }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--no-extensions",
      "--tools",
      "bash,read",
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "--extension",
      "/tmp/child-extension.ts",
      "Task: Design a seam.",
    ]);
  });

  it("lets child Pi use normal tools and extensions when configured as null", () => {
    expect(
      buildSubagentArgs(agent(), "Design a seam.", undefined, {
        extensions: null,
        environment: {},
        tools: null,
        offline: true,
      }),
    ).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--model",
      "openai-codex/gpt-5.4-mini",
      "--thinking",
      "medium",
      "Task: Design a seam.",
    ]);
  });
});

describe("runSubagent", () => {
  it("parses child Pi JSON events and streams progress", async () => {
    const dir = makeTempDir();
    const child = writeExecutable(
      dir,
      `
const message = {
  role: "assistant",
  provider: "openai-codex",
  model: "gpt-5.4-mini",
  content: [{ type: "text", text: "final design" }],
  usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.0123 } },
  stopReason: "end"
};
console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "src/foo.ts" } }));
console.log(JSON.stringify({ type: "message_end", message }));
console.log(JSON.stringify({ type: "agent_end", messages: [message] }));
`,
    );
    process.env.PI_SUBAGENT_PI_COMMAND = child;

    const updates: string[] = [];
    const result = await runSubagent({
      cwd: dir,
      agent: agent(),
      task: "Design a seam.",
      config: { extensions: [], environment: {}, offline: true },
      makeDetails: (results) => ({ agentDirs: { user: dir, project: dir, projectTrusted: false }, results }),
      onUpdate: (partial) => {
        const text = partial.content.find((part) => part.type === "text")?.text;
        if (text) updates.push(text);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.provider).toBe("openai-codex");
    expect(result.model).toBe("gpt-5.4-mini");
    expect(result.usage).toMatchObject({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1, cost: 0.0123, turns: 1 });
    expect(result.activities?.[0]).toMatchObject({ type: "tool", toolName: "read", status: "running" });
    expect(updates.join("\n")).toContain("final design");
  });

  it("overlays configured child environment", async () => {
    const dir = makeTempDir();
    const argFile = path.join(dir, "args.json");
    process.env.PI_OFFLINE = "parent-value";
    process.env.PI_SUBAGENT_ARG_FILE = argFile;
    process.env.PI_SUBAGENT_PI_COMMAND = writeExecutable(
      dir,
      `
const fs = require("node:fs");
fs.writeFileSync(process.env.PI_SUBAGENT_ARG_FILE, JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    CHILD_MARKER: process.env.PI_SUBAGENT_CHILD,
    PI_OFFLINE: process.env.PI_OFFLINE || null,
    FOO: process.env.FOO || null,
  },
}));
const message = {
  role: "assistant",
  provider: "openai-codex",
  model: "gpt-5.4-mini",
  content: [{ type: "text", text: "final design" }],
  stopReason: "end"
};
console.log(JSON.stringify({ type: "message_end", message }));
console.log(JSON.stringify({ type: "agent_end", messages: [message] }));
`,
    );

    await runSubagent({
      cwd: dir,
      agent: agent(),
      task: "Design a seam.",
      config: {
        extensions: [],
        environment: { FOO: "bar" },
        offline: false,
      },
      makeDetails: (results) => ({ agentDirs: { user: dir, project: dir, projectTrusted: false }, results }),
    });

    const captured = JSON.parse(fs.readFileSync(argFile, "utf8")) as {
      argv: string[];
      env: { CHILD_MARKER: string; PI_OFFLINE: string | null; FOO: string | null };
    };
    expect(captured.argv).toContain("--no-extensions");
    expect(captured.argv).toContain("--tools");
    expect(captured.argv).toContain("read,grep");
    expect(captured.env).toEqual({ CHILD_MARKER: "1", PI_OFFLINE: null, FOO: "bar" });
  });

  it("treats exit 0 without a final assistant response as an error", async () => {
    const dir = makeTempDir();
    process.env.PI_SUBAGENT_PI_COMMAND = writeExecutable(dir, "process.exit(0);\n");

    const result = await runSubagent({
      cwd: dir,
      agent: agent(),
      task: "Design a seam.",
      config: { extensions: [], environment: {}, offline: true },
      makeDetails: (results) => ({ agentDirs: { user: dir, project: dir, projectTrusted: false }, results }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Subagent exited without a final assistant response.");
  });
});
