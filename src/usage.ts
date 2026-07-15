import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChildResult } from "./core/types.js";

export const PI_USAGE_RECORDED = "pi.usage.recorded";

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
};

export type UsageRecordedData = {
  schemaVersion: 1;
  source: "extension";
  extension: string;
  agent?: string;
  operation?: string;
  tags?: Record<string, string>;
  model?: { provider?: string; id?: string };
  usage: UsageTotals;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeUsage(value: unknown): UsageTotals {
  const usage = isRecord(value) ? value : {};
  const cost = isRecord(usage.cost) ? nonNegativeNumber(usage.cost.total) : nonNegativeNumber(usage.cost);
  const input = nonNegativeNumber(usage.input);
  const output = nonNegativeNumber(usage.output);
  const cacheRead = nonNegativeNumber(usage.cacheRead);
  const cacheWrite = nonNegativeNumber(usage.cacheWrite);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: nonNegativeNumber(usage.totalTokens) || input + output + cacheRead + cacheWrite,
    cost,
  };
}

function buildUsageRecordedData(
  args: Omit<UsageRecordedData, "schemaVersion" | "source" | "usage"> & { usage: unknown },
): UsageRecordedData {
  return {
    schemaVersion: 1,
    source: "extension",
    extension: args.extension,
    ...(args.agent ? { agent: args.agent } : {}),
    ...(args.operation ? { operation: args.operation } : {}),
    ...(args.tags ? { tags: args.tags } : {}),
    ...(args.model ? { model: args.model } : {}),
    usage: normalizeUsage(args.usage),
  };
}

export function recordChildUsage(
  pi: ExtensionAPI,
  result: ChildResult,
  metadata: Omit<UsageRecordedData, "schemaVersion" | "source" | "usage" | "model">,
): void {
  const usage = normalizeUsage(result.usage);
  if (usage.totalTokens === 0 && usage.cost === 0) return;
  pi.appendEntry(PI_USAGE_RECORDED, buildUsageRecordedData({
    ...metadata,
    model: { provider: result.provider, id: result.model },
    usage,
  }));
}
