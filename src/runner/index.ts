import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agents.js";
import { processPiJsonLine } from "../child-events/index.js";
import { getChildProgressText } from "../child-events/progress.js";
import type { SubagentConfig } from "../config.js";
import { emptyUsage, normalizeCompletedResult, type SubagentDetails, type SubagentResult } from "../core/types.js";
import { buildChildEnv } from "./env.js";

const isWindows = process.platform === "win32";
const SIGKILL_TIMEOUT_MS = 5000;

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;
export type ContextWindowResolver = (provider?: string, model?: string) => number | undefined;

export interface RunSubagentOptions {
  cwd: string;
  agent: AgentConfig;
  task: string;
  childCwd?: string;
  config?: SubagentConfig;
  signal?: AbortSignal;
  onUpdate?: OnUpdateCallback;
  makeDetails: (results: SubagentResult[]) => SubagentDetails;
  resolveContextWindow?: ContextWindowResolver;
}

export function resolvePiSpawn(): { command: string; prefixArgs: string[] } {
  const configured = process.env.PI_SUBAGENT_PI_COMMAND?.trim();
  return { command: configured || "pi", prefixArgs: [] };
}

function parseModel(model: string | undefined): { provider?: string; id?: string } {
  const trimmed = model?.trim();
  if (!trimmed) return {};
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
    return { provider: trimmed.slice(0, slashIndex), id: trimmed.slice(slashIndex + 1) };
  }
  return { id: trimmed };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(dir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir, filePath };
}

function cleanupTempDir(dir: string | null): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function buildPiArgs(agent: AgentConfig, task: string, promptPath: string | undefined, config?: SubagentConfig): string[] {
  const extensions = config ? config.extensions : [];
  const configuredTools = config && Object.prototype.hasOwnProperty.call(config, "tools") ? config.tools : undefined;
  const toolAllowlist = configuredTools === undefined ? agent.tools.join(",") : configuredTools;
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-skills",
    "--no-prompt-templates",
  ];

  if (extensions !== null) args.push("--no-extensions");

  if (toolAllowlist !== null) {
    if (toolAllowlist === "") args.push("--no-tools");
    else args.push("--tools", toolAllowlist);
  }

  if (agent.model) args.push("--model", agent.model);
  if (agent.thinking) args.push("--thinking", agent.thinking);
  if (promptPath) args.push("--append-system-prompt", promptPath);
  if (extensions !== null) {
    for (const extension of extensions) args.push("--extension", extension);
  }
  args.push(`Task: ${task}`);
  return args;
}

function createInitialResult(agent: AgentConfig, task: string): SubagentResult {
  const parsedModel = parseModel(agent.model);
  return {
    agent: agent.name,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    provider: parsedModel.provider,
    model: parsedModel.id,
  };
}

export async function runSubagent(opts: RunSubagentOptions): Promise<SubagentResult> {
  const { cwd, agent, task, childCwd, config, signal, onUpdate, makeDetails, resolveContextWindow } = opts;
  const result = createInitialResult(agent, task);

  const enrichContextWindow = () => {
    if (result.usage.contextWindow || !resolveContextWindow) return;
    const contextWindow = resolveContextWindow(result.provider, result.model);
    if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
      result.usage.contextWindow = contextWindow;
    }
  };

  const emitUpdate = () => {
    enrichContextWindow();
    onUpdate?.({
      content: [{ type: "text", text: getChildProgressText(result) }],
      details: makeDetails([result]),
    });
  };

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | undefined;

  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
    }

    const piArgs = buildPiArgs(agent, task, tmpPromptPath, config);
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const { command, prefixArgs } = resolvePiSpawn();
      const proc = spawn(command, [...prefixArgs, ...piArgs], {
        cwd: childCwd ?? cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildChildEnv(config?.environment, process.env, process.platform, config?.offline ?? true),
      });

      proc.stdin.on("error", () => {
        /* ignore broken pipe on fast exits */
      });
      proc.stdin.end();

      let buffer = "";
      let didClose = false;
      let settled = false;
      let abortHandler: (() => void) | undefined;

      const terminateChild = () => {
        if (isWindows) {
          if (proc.pid !== undefined) {
            const killer = spawn("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore" });
            killer.unref();
          }
          return;
        }

        proc.kill("SIGTERM");
        const sigkillTimer = setTimeout(() => {
          if (!didClose) proc.kill("SIGKILL");
        }, SIGKILL_TIMEOUT_MS);
        sigkillTimer.unref();
      };

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
        resolve(code);
      };

      const flushLine = (line: string) => {
        if (processPiJsonLine(line, result)) emitUpdate();
      };

      const flushBufferedLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) flushLine(line);
        }
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) flushLine(line);
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        result.stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        didClose = true;
        if (buffer.trim()) flushBufferedLines(buffer);
        finish(code ?? 0);
      });

      proc.on("error", (error) => {
        if (!result.stderr.trim()) result.stderr = error.message;
        finish(1);
      });

      if (signal) {
        abortHandler = () => {
          if (didClose || settled) return;
          wasAborted = true;
          terminateChild();
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    result.exitCode = exitCode;
    enrichContextWindow();
    return normalizeCompletedResult(result, wasAborted);
  } finally {
    cleanupTempDir(tmpPromptDir);
  }
}
