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

export function normalizeUsage(value: unknown): UsageTotals {
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

export function buildUsageRecordedData(
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
