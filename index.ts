import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDefinedSubagents } from "./src/extension.js";

export default function definedSubagents(pi: ExtensionAPI) {
  registerDefinedSubagents(pi);
}
