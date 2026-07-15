import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { processPiJsonLine } from "../child-events/index.js";
import { getChildProgressText } from "../child-events/progress.js";
import {
  type ChildKind,
  type ChildResult,
  normalizeCompletedResult,
} from "../core/types.js";
import { buildChildEnv } from "./env.js";

const isWindows = process.platform === "win32";
const SIGKILL_TIMEOUT_MS = 5000;

export type ContextWindowResolver = (provider?: string, model?: string) => number | undefined;

export interface ChildActivation {
  command: string;
  args: string[];
}

export interface ChildResources {
  systemPromptPath?: string;
  sessionPath?: string;
  scratchDir?: string;
}

export interface RunChildOptions<TResult extends ChildResult, TDetails> {
  kind: ChildKind;
  cwd: string;
  result: TResult;
  buildArgs: (resources: ChildResources) => string[];
  systemPrompt?: string;
  writeSessionSnapshot?: (filePath: string) => boolean;
  scratchParent?: string;
  environment?: Record<string, string> | ((resources: ChildResources) => Record<string, string>);
  activation?: ChildActivation | null;
  offline?: boolean;
  signal?: AbortSignal;
  onUpdate?: (partial: AgentToolResult<TDetails>) => void;
  makeDetails: (results: TResult[]) => TDetails;
  resolveContextWindow?: ContextWindowResolver;
}

export function resolvePiSpawn(
  cwd = process.cwd(),
  activation: ChildActivation | null = null,
): { command: string; prefixArgs: string[] } {
  const piCommand = process.env.PI_SUBAGENT_PI_COMMAND?.trim() || "pi";
  if (!activation) return { command: piCommand, prefixArgs: [] };
  return {
    command: activation.command,
    prefixArgs: [...activation.args.map((arg) => arg.replaceAll("{cwd}", cwd)), piCommand],
  };
}

function createTempRoot(kind: ChildKind): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pi-subagent-${kind}-`));
}

function createScratch(parent: string): string {
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  return fs.mkdtempSync(path.join(parent, "pi-subagent-scratch-"));
}

function cleanupTempDir(dir: string | undefined): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Cleanup is best effort after the child has settled.
  }
}

function writePrivateFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
}

export async function runChild<TResult extends ChildResult, TDetails>(
  options: RunChildOptions<TResult, TDetails>,
): Promise<TResult> {
  const {
    kind,
    cwd,
    result,
    buildArgs,
    systemPrompt,
    writeSessionSnapshot,
    scratchParent,
    environment = {},
    activation = null,
    offline = true,
    signal,
    onUpdate,
    makeDetails,
    resolveContextWindow,
  } = options;

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

  const failBeforeSpawn = (message: string): TResult => {
    result.exitCode = signal?.aborted ? 130 : 1;
    result.stderr = message;
    result.stopReason = signal?.aborted ? "aborted" : "error";
    result.errorMessage = message;
    return result;
  };

  let tempRoot: string | undefined;
  let scratchDir: string | undefined;

  try {
    const needsTempRoot = Boolean(systemPrompt?.trim() || writeSessionSnapshot);
    if (needsTempRoot) tempRoot = createTempRoot(kind);

    const resources: ChildResources = {};
    if (systemPrompt?.trim() && tempRoot) {
      resources.systemPromptPath = path.join(tempRoot, "system-prompt.md");
      writePrivateFile(resources.systemPromptPath, systemPrompt);
    }
    if (writeSessionSnapshot && tempRoot) {
      resources.sessionPath = path.join(tempRoot, "session.jsonl");
      try {
        if (!writeSessionSnapshot(resources.sessionPath)) {
          return failBeforeSpawn("Cannot fork: failed to snapshot current session context.");
        }
      } catch (error) {
        return failBeforeSpawn(error instanceof Error ? error.message : String(error));
      }
    }
    if (scratchParent) {
      scratchDir = createScratch(scratchParent);
      resources.scratchDir = scratchDir;
    }

    const args = buildArgs(resources);
    let wasAborted = false;
    const exitCode = await new Promise<number>((resolve) => {
      const { command, prefixArgs } = resolvePiSpawn(cwd, activation);
      const proc = spawn(command, [...prefixArgs, ...args], {
        cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: buildChildEnv(
          typeof environment === "function" ? environment(resources) : environment,
          process.env,
          process.platform,
          offline,
          kind,
        ),
      });

      proc.stdin.on("error", () => {
        // Ignore broken pipes when the child exits before reading stdin.
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
    return normalizeCompletedResult(result, wasAborted, kind);
  } finally {
    cleanupTempDir(tempRoot);
    cleanupTempDir(scratchDir);
  }
}
