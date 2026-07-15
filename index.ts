import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDefinedSubagents } from "./src/extension.js";
import { registerForkTool } from "./src/fork/tool.js";
import { PI_SUBAGENT_CHILD_ENV } from "./src/runner/env.js";

export default function piSubagent(pi: ExtensionAPI): void {
  if (process.env[PI_SUBAGENT_CHILD_ENV] === "1") return;
  registerForkTool(pi);
  registerDefinedSubagents(pi);
}
