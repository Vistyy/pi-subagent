import { closeSync, openSync, writeSync } from "node:fs";

export interface SessionSnapshotSource {
  getHeader: () => unknown;
  buildSessionContext?: () => { messages: unknown[] };
  getBranch?: () => unknown[];
}

type SessionEntry = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
};

function stringifyEntry(entry: unknown): string {
  const serialized = JSON.stringify(entry);
  if (typeof serialized !== "string") {
    throw new Error("Cannot fork: session snapshot contains an unserializable entry.");
  }
  return serialized;
}

function writeJsonlEntry(fd: number, entry: unknown): void {
  writeSync(fd, stringifyEntry(entry));
  writeSync(fd, "\n");
}

function syntheticId(index: number): string {
  return `fork${index.toString(16).padStart(4, "0")}`;
}

function timestampFromMessage(message: Record<string, unknown>, fallbackIndex: number): string {
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return new Date(message.timestamp).toISOString();
  }
  if (typeof message.timestamp === "string") {
    const date = new Date(message.timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(fallbackIndex).toISOString();
}

function textContentBlocks(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => {
    if (!block || typeof block !== "object") return false;
    return (block as Record<string, unknown>).type === "text";
  });
}

function sanitizeUserMessage(message: Record<string, unknown>): Record<string, unknown> | null {
  return { ...message };
}

function sanitizeAssistantMessage(message: Record<string, unknown>): Record<string, unknown> | null {
  const content = textContentBlocks(message.content);
  if (content.length === 0) return null;
  return { ...message, content };
}

function contextMessageToEntry(message: unknown, index: number, parentId: string | null): SessionEntry | null {
  if (!message || typeof message !== "object") return null;

  const record = message as Record<string, unknown>;
  const role = record.role;
  const id = syntheticId(index);
  const timestamp = timestampFromMessage(record, index);

  if (role === "compactionSummary") {
    const summary = typeof record.summary === "string" ? record.summary : "";
    if (!summary.trim()) return null;
    const tokensBefore = typeof record.tokensBefore === "number" && Number.isFinite(record.tokensBefore)
      ? record.tokensBefore
      : 0;
    return {
      type: "compaction",
      id,
      parentId,
      timestamp,
      summary,
      firstKeptEntryId: "",
      tokensBefore,
    };
  }

  if (role === "user") {
    const sanitized = sanitizeUserMessage(record);
    if (!sanitized) return null;
    return { type: "message", id, parentId, timestamp, message: sanitized };
  }

  if (role === "assistant") {
    const sanitized = sanitizeAssistantMessage(record);
    if (!sanitized) return null;
    return { type: "message", id, parentId, timestamp, message: sanitized };
  }

  return null;
}

function buildCurrentContextEntries(messages: unknown[]): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let parentId: string | null = null;

  for (const message of messages) {
    const entry = contextMessageToEntry(message, entries.length + 1, parentId);
    if (!entry) continue;
    entries.push(entry);
    parentId = entry.id;
  }

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].type === "compaction") {
      entries[i].firstKeptEntryId = entries[i + 1]?.id ?? "";
    }
  }

  return entries;
}

function buildCurrentContextSnapshot(header: unknown, messages: unknown[]): string {
  let snapshot = `${stringifyEntry(header)}\n`;
  for (const entry of buildCurrentContextEntries(messages)) snapshot += `${stringifyEntry(entry)}\n`;
  return snapshot;
}

function isSessionEntry(entry: unknown): entry is SessionEntry {
  return Boolean(entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).type === "string");
}

function messageFromEntry(entry: SessionEntry): unknown | null {
  if (entry.type === "message") return entry.message ?? null;
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: typeof entry.summary === "string" ? entry.summary : "",
      tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
      timestamp: entry.timestamp,
    };
  }
  if (entry.type === "branch_summary") {
    return {
      role: "branchSummary",
      summary: typeof entry.summary === "string" ? entry.summary : "",
      fromId: typeof entry.fromId === "string" ? entry.fromId : "",
      timestamp: entry.timestamp,
    };
  }
  return null;
}

function messagesFromBranch(entries: unknown[]): unknown[] {
  const branch = entries.filter(isSessionEntry);
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionIndex = i;
      break;
    }
  }
  if (compactionIndex === -1) return branch.map(messageFromEntry).filter((message) => message !== null);

  const compaction = branch[compactionIndex];
  const messages: unknown[] = [messageFromEntry(compaction)].filter((message) => message !== null);
  let foundFirstKept = false;

  for (let i = 0; i < compactionIndex; i++) {
    const entry = branch[i];
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
    if (foundFirstKept) {
      const message = messageFromEntry(entry);
      if (message !== null) messages.push(message);
    }
  }

  for (let i = compactionIndex + 1; i < branch.length; i++) {
    const message = messageFromEntry(branch[i]);
    if (message !== null) messages.push(message);
  }

  return messages;
}

function getSnapshotMessages(sessionManager: SessionSnapshotSource): unknown[] {
  if (typeof sessionManager.buildSessionContext === "function") {
    const context = sessionManager.buildSessionContext();
    return Array.isArray(context.messages) ? context.messages : [];
  }
  if (typeof sessionManager.getBranch === "function") return messagesFromBranch(sessionManager.getBranch());
  return [];
}

export function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
): string | null {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return null;

  return buildCurrentContextSnapshot(header, getSnapshotMessages(sessionManager));
}

export function writeForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
  filePath: string,
): boolean {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return false;

  const fd = openSync(filePath, "w", 0o600);
  try {
    writeJsonlEntry(fd, header);
    for (const entry of buildCurrentContextEntries(getSnapshotMessages(sessionManager))) writeJsonlEntry(fd, entry);
    return true;
  } finally {
    closeSync(fd);
  }
}
