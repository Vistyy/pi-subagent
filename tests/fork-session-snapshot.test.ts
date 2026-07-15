import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildForkSessionSnapshotJsonl, writeForkSessionSnapshotJsonl } from "../src/fork/session-snapshot.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagent-snapshot-"));
  tempDirs.push(dir);
  return join(dir, "fork.jsonl");
}

const header = { type: "session", id: "session-1" };

function userMessage(text: string) {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistantMessage(content: unknown[]) {
  return {
    role: "assistant",
    content,
    api: "responses",
    provider: "openai",
    model: "gpt",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 2,
  };
}

function toolResultMessage(text: string) {
  return { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text }], isError: false, timestamp: 3 };
}

function compactionSummary(summary: string) {
  return { role: "compactionSummary", summary, tokensBefore: 123, timestamp: 4 };
}

function session(messages: unknown[]) {
  return { getHeader: () => header, buildSessionContext: () => ({ messages }) };
}

function lines(jsonl: string): any[] {
  return jsonl.trim().split("\n").map((line) => JSON.parse(line));
}

describe("fork session snapshots", () => {
  it("copies only current-context user and visible assistant messages", () => {
    const assistant = assistantMessage([
      { type: "thinking", thinking: "hidden reasoning" },
      { type: "text", text: "visible answer" },
      { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pnpm test" } },
    ]);

    const snapshot = buildForkSessionSnapshotJsonl(session([
      userMessage("one"),
      assistant,
      toolResultMessage("secret output"),
      { role: "bashExecution", command: "echo hidden", output: "hidden", timestamp: 5 },
      { role: "branchSummary", summary: "stale branch", fromId: "old", timestamp: 6 },
    ]));

    const entries = lines(snapshot ?? "");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual(header);
    expect(entries[1].message).toEqual(userMessage("one"));
    expect(entries[2].message).toEqual({ ...assistant, content: [{ type: "text", text: "visible answer" }] });
    expect(JSON.stringify(entries)).not.toContain("hidden reasoning");
    expect(JSON.stringify(entries)).not.toContain("pnpm test");
    expect(JSON.stringify(entries)).not.toContain("secret output");
    expect(JSON.stringify(entries)).not.toContain("stale branch");
  });

  it("derives the current context window from the active branch when needed", () => {
    const snapshot = buildForkSessionSnapshotJsonl({
      getHeader: () => header,
      getBranch: () => [
        { type: "message", id: "old-user", parentId: null, timestamp: "2026-06-21T00:00:00.000Z", message: userMessage("before compact dropped") },
        { type: "message", id: "kept-user", parentId: "old-user", timestamp: "2026-06-21T00:00:01.000Z", message: userMessage("before compact kept") },
        { type: "compaction", id: "compact", parentId: "kept-user", timestamp: "2026-06-21T00:00:02.000Z", summary: "old work summary", firstKeptEntryId: "kept-user", tokensBefore: 123 },
        { type: "message", id: "after-user", parentId: "compact", timestamp: "2026-06-21T00:00:03.000Z", message: userMessage("after compact") },
        { type: "message", id: "tool", parentId: "after-user", timestamp: "2026-06-21T00:00:04.000Z", message: toolResultMessage("dropped") },
      ],
    });

    const entries = lines(snapshot ?? "");
    expect(entries.map((entry) => entry.type)).toEqual(["session", "compaction", "message", "message"]);
    expect(entries[1]).toMatchObject({ summary: "old work summary", firstKeptEntryId: entries[2].id });
    expect(entries[2].message).toEqual(userMessage("before compact kept"));
    expect(entries[3].message).toEqual(userMessage("after compact"));
    expect(JSON.stringify(entries)).not.toContain("before compact dropped");
    expect(JSON.stringify(entries)).not.toContain("dropped");
  });

  it("preserves compaction summary before current-context user and assistant messages", () => {
    const snapshot = buildForkSessionSnapshotJsonl(session([
      compactionSummary("old work summary"),
      userMessage("after compact"),
      assistantMessage([{ type: "text", text: "new answer" }]),
    ]));

    const entries = lines(snapshot ?? "");
    expect(entries.map((entry) => entry.type)).toEqual(["session", "compaction", "message", "message"]);
    expect(entries[1]).toMatchObject({
      type: "compaction",
      summary: "old work summary",
      tokensBefore: 123,
      firstKeptEntryId: entries[2].id,
      parentId: null,
    });
    expect(entries[2]).toMatchObject({ parentId: entries[1].id, message: userMessage("after compact") });
    expect(entries[3]).toMatchObject({ parentId: entries[2].id });
  });

  it("does not point compaction firstKeptEntryId at dropped context messages", () => {
    const snapshot = buildForkSessionSnapshotJsonl(session([
      compactionSummary("old work summary"),
      toolResultMessage("dropped"),
    ]));

    const entries = lines(snapshot ?? "");
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ type: "compaction", firstKeptEntryId: "" });
  });

  it("writes the filtered current context directly to a file", () => {
    const filePath = tempPath();

    expect(writeForkSessionSnapshotJsonl(session([userMessage("one"), toolResultMessage("dropped")]), filePath)).toBe(true);

    const entries = lines(readFileSync(filePath, "utf-8"));
    expect(entries).toHaveLength(2);
    expect(entries[1].message).toEqual(userMessage("one"));
    expect(JSON.stringify(entries)).not.toContain("dropped");
  });

  it("returns null when the session header is unavailable", () => {
    expect(buildForkSessionSnapshotJsonl({ getHeader: () => null, buildSessionContext: () => ({ messages: [] }) })).toBeNull();
  });

  it("does not write a file when the session header is unavailable", () => {
    const filePath = tempPath();

    expect(writeForkSessionSnapshotJsonl({ getHeader: () => null, buildSessionContext: () => ({ messages: [] }) }, filePath)).toBe(false);
  });
});
