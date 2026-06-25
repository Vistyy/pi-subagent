import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const SETTINGS_KEY = "pi-subagent";

export interface SubagentConfig {
  /**
   * Extensions to load in child subagent processes.
   * - null: load normal Pi extensions from settings and auto-discovery
   * - []: load no extensions
   * - non-empty: load only these extension sources
   */
  extensions: string[] | null;

  /** Environment variables to overlay onto child subagent processes. */
  environment: Record<string, string>;

  /**
   * Tool allowlist for child subagent processes.
   * - undefined: use the selected identity's frontmatter tools
   * - null: let child Pi use its normal tool behavior
   * - "": pass --no-tools
   * - non-empty: pass --tools <value>
   */
  tools?: string | null;

  /** Controls PI_OFFLINE for child Pi processes. */
  offline: boolean;
}

export const DEFAULT_CONFIG: SubagentConfig = {
  extensions: [],
  environment: {},
  offline: true,
};

type ParsedSubagentConfig = Partial<SubagentConfig>;

function isPackageSource(value: string): boolean {
  return value.startsWith("npm:") || value.startsWith("git:");
}

function resolveConfiguredPath(value: string, baseDir: string): string {
  if (!value) return value;
  if (isPackageSource(value)) return value;
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function parseConfiguredSource(raw: unknown, baseDir: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? resolveConfiguredPath(trimmed, baseDir) : undefined;
}

function parseExtensions(raw: unknown, baseDir: string): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;

  const extensions: string[] = [];
  for (const value of raw) {
    const source = parseConfiguredSource(value, baseDir);
    if (source) extensions.push(source);
  }
  return extensions;
}

function parseTools(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;

  const names = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  if (!names.every((name) => /^[a-zA-Z0-9_-]+$/.test(name))) return undefined;
  return names.join(",");
}

function defineEnvironmentValue(target: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function copyEnvironment(source: Record<string, string> | undefined): Record<string, string> {
  const target: Record<string, string> = {};
  if (!source) return target;

  for (const [key, value] of Object.entries(source)) {
    defineEnvironmentValue(target, key, value);
  }
  return target;
}

export function parseEnvironment(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const environment: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.includes("=") || key.includes("\0") || typeof rawValue !== "string" || rawValue.includes("\0")) {
      continue;
    }
    defineEnvironmentValue(environment, key, rawValue);
  }
  return environment;
}

export function mergeEnvironment(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const environment = copyEnvironment(base);
  if (!overrides) return environment;

  if (platform === "win32") {
    for (const [overrideKey, overrideValue] of Object.entries(overrides)) {
      const normalizedKey = overrideKey.toLowerCase();
      for (const key of Object.keys(environment)) {
        if (key.toLowerCase() === normalizedKey) delete environment[key];
      }
      defineEnvironmentValue(environment, overrideKey, overrideValue);
    }
    return environment;
  }

  for (const [overrideKey, overrideValue] of Object.entries(overrides)) {
    defineEnvironmentValue(environment, overrideKey, overrideValue);
  }
  return environment;
}

function readNamespacedConfig(settingsPath: string, baseDir: string): ParsedSubagentConfig {
  if (!existsSync(settingsPath)) return {};

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const nested = raw[SETTINGS_KEY];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return {};

    const config = nested as Record<string, unknown>;
    const extensions = parseExtensions(config.extensions, baseDir);
    const environment = parseEnvironment(config.environment);
    const tools = parseTools(config.tools);
    const parsed: ParsedSubagentConfig = {};
    if (extensions !== undefined) parsed.extensions = extensions;
    if (environment !== undefined) parsed.environment = environment;
    if (tools !== undefined) parsed.tools = tools;
    if (typeof config.offline === "boolean") parsed.offline = config.offline;
    return parsed;
  } catch {
    return {};
  }
}

export function loadConfig(cwd: string): SubagentConfig {
  const agentDir = getAgentDir();
  const globalPath = path.join(agentDir, "settings.json");
  const projectSettingsDir = path.join(cwd, CONFIG_DIR_NAME);
  const projectPath = path.join(projectSettingsDir, "settings.json");
  const globalConfig = readNamespacedConfig(globalPath, agentDir);
  const projectConfig = readNamespacedConfig(projectPath, projectSettingsDir);

  const resolved: SubagentConfig = {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
    environment: mergeEnvironment(globalConfig.environment, projectConfig.environment),
  };

  if (projectConfig.tools !== undefined) resolved.tools = projectConfig.tools;
  else if (globalConfig.tools !== undefined) resolved.tools = globalConfig.tools;
  else delete resolved.tools;

  return resolved;
}
