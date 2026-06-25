import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentSource = "user" | "project";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentConfig {
  name: string;
  description: string;
  tools: string[];
  model?: string;
  thinking?: ThinkingLevel;
  systemPrompt: string;
  filePath: string;
  source: AgentSource;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  userAgentsDir: string;
  projectAgentsDir: string;
  projectTrusted: boolean;
}

export interface AgentDiscoveryOptions {
  cwd?: string;
  userAgentsDir?: string;
  projectAgentsDir?: string;
  projectTrusted?: boolean;
}

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

function parseTools(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

function parseThinking(value: unknown): ThinkingLevel | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim() as ThinkingLevel;
  return THINKING_LEVELS.has(trimmed) ? trimmed : undefined;
}

export function getUserAgentsDir(): string {
  return path.join(getAgentDir(), "agents");
}

export function getProjectAgentsDir(cwd: string): string {
  return path.join(cwd, CONFIG_DIR_NAME, "agents");
}

export function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content);
    const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
    const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
    const tools = parseTools(frontmatter.tools);
    const model = typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;
    const thinking = parseThinking(frontmatter.thinking);

    if (!name || !description || !NAME_PATTERN.test(name)) continue;
    if (tools.length === 0) continue;

    agents.push({
      name,
      description,
      tools,
      model: model || undefined,
      thinking,
      systemPrompt: body.trim(),
      filePath,
      source,
    });
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverAgents(options: AgentDiscoveryOptions = {}): AgentDiscoveryResult {
  const cwd = options.cwd ?? process.cwd();
  const userAgentsDir = options.userAgentsDir ?? getUserAgentsDir();
  const projectAgentsDir = options.projectAgentsDir ?? getProjectAgentsDir(cwd);
  const projectTrusted = options.projectTrusted ?? false;
  const byName = new Map<string, AgentConfig>();

  for (const agent of loadAgentsFromDir(userAgentsDir, "user")) {
    byName.set(agent.name, agent);
  }

  if (projectTrusted) {
    for (const agent of loadAgentsFromDir(projectAgentsDir, "project")) {
      byName.set(agent.name, agent);
    }
  }

  return {
    agents: Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)),
    userAgentsDir,
    projectAgentsDir,
    projectTrusted,
  };
}

export function formatAgentList(agents: AgentConfig[]): string {
  if (agents.length === 0) return "none";
  return agents.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; ");
}
