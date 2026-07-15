import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { registerDefinedSubagents } from "./src/extension.js";
import { aggregateInclusiveCost, formatForkCostStatus } from "./src/fork/core/cost.js";
import { registerForkTool } from "./src/fork/tool.js";
import { PI_SUBAGENT_CHILD_ENV } from "./src/runner/env.js";

const FORK_COST_STATUS_KEY = "fork-cost";

function updateForkCostStatus(ctx: ExtensionContext): void {
  if (!loadConfig(ctx.cwd).fork.costFooter) {
    ctx.ui.setStatus(FORK_COST_STATUS_KEY, undefined);
    return;
  }
  const status = formatForkCostStatus(aggregateInclusiveCost(ctx.sessionManager.getEntries()));
  ctx.ui.setStatus(FORK_COST_STATUS_KEY, status ? ctx.ui.theme.fg("dim", status) : undefined);
}

export default function piSubagent(pi: ExtensionAPI): void {
  if (process.env[PI_SUBAGENT_CHILD_ENV] === "1") return;

  pi.on("session_start", async (_event, ctx) => updateForkCostStatus(ctx));
  pi.on("turn_end", async (_event, ctx) => updateForkCostStatus(ctx));
  pi.on("session_tree", async (_event, ctx) => updateForkCostStatus(ctx));
  pi.on("session_shutdown", async (_event, ctx) => ctx.ui.setStatus(FORK_COST_STATUS_KEY, undefined));

  registerForkTool(pi);
  registerDefinedSubagents(pi);
}
