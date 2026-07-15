import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ForkEffort, ForkEffortProfile, ThinkingLevel } from "./core/types.js";

const SETTINGS_KEY = "pi-subagent";

export const EFFORT_LEVELS = ["fast", "balanced", "deep"] as const;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export interface SubagentConfig {
  /** Extensions loaded by named subagent processes. */
  extensions: string[] | null;

  /** Environment variables overlaid onto named subagent processes. */
  environment: Record<string, string>;

  /**
   * Named subagent tool policy.
   * - undefined: use the identity frontmatter tools
   * - null: let child Pi use normal tool behavior
   * - "": pass --no-tools
   * - non-empty: pass --tools <value>
   */
  tools?: string | null;

  /** Controls PI_OFFLINE for named subagent processes. */
  offline: boolean;
}

export interface ForkSandboxConfig {
  /** Whether sandboxed fork Bash may use the host network. */
  bashNetwork: boolean;

  /** Writable TMPDIR inside sandboxed fork Bash. Must be under /tmp or /var/tmp. */
  tmpDir: string;
}

export interface ForkActivationConfig {
  /** Command that activates the fork process environment before running Pi. */
  command: string;

  /** Arguments passed before the Pi command. Use {cwd} to insert the fork cwd. */
  args: string[];
}

export interface ForkConfig {
  /** Extensions loaded by fork processes. */
  extensions: string[] | null;

  /** Environment variables overlaid onto fork processes. */
  environment: Record<string, string>;

  /** Optional wrapper that activates the fork process environment before running Pi. */
  activation: ForkActivationConfig | null;

  /** Fork tool allowlist. Null inherits parent Pi tool flags. */
  tools: string | null;

  /** Controls PI_OFFLINE for fork processes. */
  offline: boolean;

  /** Sandbox policy used by the optional sandbox extension. */
  sandbox: ForkSandboxConfig;

  /** Show aggregate fork cost in the footer. */
  costFooter: boolean;

  /** Effort used when a fork call omits effort. */
  defaultEffort: ForkEffort;

  /** Per-effort child model and thinking profiles. */
  effortProfiles?: Partial<Record<ForkEffort, ForkEffortProfile>>;
}

export interface PiSubagentConfig {
  subagent: SubagentConfig;
  fork: ForkConfig;
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  extensions: [],
  environment: {},
  offline: true,
};

export const DEFAULT_SANDBOX_CONFIG: ForkSandboxConfig = {
  bashNetwork: false,
  tmpDir: "/tmp",
};

export const DEFAULT_FORK_CONFIG: ForkConfig = {
  extensions: [],
  environment: {},
  activation: null,
  tools: null,
  offline: true,
  sandbox: DEFAULT_SANDBOX_CONFIG,
  costFooter: true,
  defaultEffort: "balanced",
};

function isPackageSource(value: string): boolean {
  return value.startsWith("npm:") || value.startsWith("git:");
}

function resolveConfiguredPath(value: string, baseDir: string): string {
  if (!value || isPackageSource(value)) return value;
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

  const names = raw.split(",").map((name) => name.trim()).filter(Boolean);
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
  for (const [key, value] of Object.entries(source)) defineEnvironmentValue(target, key, value);
  return target;
}

export function parseEnvironment(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const environment: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.includes("=") || key.includes("\0") || typeof rawValue !== "string" || rawValue.includes("\0")) continue;
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

function isEffort(value: unknown): value is ForkEffort {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function parseEffortProfile(raw: unknown): ForkEffortProfile | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const profile = raw as Record<string, unknown>;
  const provider = typeof profile.provider === "string" ? profile.provider.trim() : "";
  const id = typeof profile.id === "string" ? profile.id.trim() : "";
  if (!provider || !id || !isThinkingLevel(profile.thinking)) return undefined;
  return { provider, id, thinking: profile.thinking };
}

function parseEffortProfiles(raw: unknown): Partial<Record<ForkEffort, ForkEffortProfile>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const profiles: Partial<Record<ForkEffort, ForkEffortProfile>> = {};
  for (const effort of EFFORT_LEVELS) {
    const profile = parseEffortProfile((raw as Record<string, unknown>)[effort]);
    if (profile) profiles[effort] = profile;
  }
  return Object.keys(profiles).length > 0 ? profiles : undefined;
}

function parseActivation(raw: unknown): ForkActivationConfig | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const config = raw as Record<string, unknown>;
  const command = typeof config.command === "string" ? config.command.trim() : "";
  if (!command || command.includes("\0") || !Array.isArray(config.args)) return undefined;

  const args: string[] = [];
  for (const arg of config.args) {
    if (typeof arg !== "string" || arg.includes("\0")) return undefined;
    args.push(arg);
  }
  return { command, args };
}

function parseSandboxTmpDir(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const tmpDir = path.posix.normalize(raw.trim());
  if (tmpDir === "/tmp" || tmpDir.startsWith("/tmp/")) return tmpDir;
  if (tmpDir === "/var/tmp" || tmpDir.startsWith("/var/tmp/")) return tmpDir;
  return undefined;
}

function parseSandbox(raw: unknown): Partial<ForkSandboxConfig> | undefined {
  if (raw === undefined || !raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const config = raw as Record<string, unknown>;
  const sandbox: Partial<ForkSandboxConfig> = {};
  const tmpDir = parseSandboxTmpDir(config.tmpDir);
  if (typeof config.bashNetwork === "boolean") sandbox.bashNetwork = config.bashNetwork;
  if (tmpDir !== undefined) sandbox.tmpDir = tmpDir;
  return Object.keys(sandbox).length > 0 ? sandbox : undefined;
}

type ParsedSubagentConfig = Partial<SubagentConfig>;
type ParsedForkConfig = Omit<Partial<ForkConfig>, "sandbox"> & { sandbox?: Partial<ForkSandboxConfig> };

type ParsedConfig = {
  subagent: ParsedSubagentConfig;
  fork: ParsedForkConfig;
};

function configSection(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNamespacedConfig(settingsPath: string, baseDir: string): ParsedConfig {
  if (!existsSync(settingsPath)) return { subagent: {}, fork: {} };

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const root = configSection(raw[SETTINGS_KEY]);
    const subagentRaw = configSection(root.subagent);
    const forkRaw = configSection(root.fork);

    const subagent: ParsedSubagentConfig = {};
    const subagentExtensions = parseExtensions(subagentRaw.extensions, baseDir);
    const subagentEnvironment = parseEnvironment(subagentRaw.environment);
    const subagentTools = parseTools(subagentRaw.tools);
    if (subagentExtensions !== undefined) subagent.extensions = subagentExtensions;
    if (subagentEnvironment !== undefined) subagent.environment = subagentEnvironment;
    if (subagentTools !== undefined) subagent.tools = subagentTools;
    if (typeof subagentRaw.offline === "boolean") subagent.offline = subagentRaw.offline;

    const fork: ParsedForkConfig = {};
    const forkExtensions = parseExtensions(forkRaw.extensions, baseDir);
    const forkEnvironment = parseEnvironment(forkRaw.environment);
    const forkTools = parseTools(forkRaw.tools);
    const activation = parseActivation(forkRaw.activation);
    const sandbox = parseSandbox(forkRaw.sandbox);
    const effortProfiles = parseEffortProfiles(forkRaw.effortProfiles);
    if (forkExtensions !== undefined) fork.extensions = forkExtensions;
    if (forkEnvironment !== undefined) fork.environment = forkEnvironment;
    if (forkTools !== undefined) fork.tools = forkTools;
    if (activation !== undefined) fork.activation = activation;
    if (typeof forkRaw.offline === "boolean") fork.offline = forkRaw.offline;
    if (sandbox !== undefined) fork.sandbox = sandbox;
    if (typeof forkRaw.costFooter === "boolean") fork.costFooter = forkRaw.costFooter;
    if (isEffort(forkRaw.defaultEffort)) fork.defaultEffort = forkRaw.defaultEffort;
    if (effortProfiles !== undefined) fork.effortProfiles = effortProfiles;

    return { subagent, fork };
  } catch {
    return { subagent: {}, fork: {} };
  }
}

export function loadConfig(cwd: string): PiSubagentConfig {
  const agentDir = getAgentDir();
  const globalPath = path.join(agentDir, "settings.json");
  const projectSettingsDir = path.join(cwd, CONFIG_DIR_NAME);
  const projectPath = path.join(projectSettingsDir, "settings.json");
  const globalConfig = readNamespacedConfig(globalPath, agentDir);
  const projectConfig = readNamespacedConfig(projectPath, projectSettingsDir);

  const subagent: SubagentConfig = {
    ...DEFAULT_SUBAGENT_CONFIG,
    ...globalConfig.subagent,
    ...projectConfig.subagent,
    environment: mergeEnvironment(globalConfig.subagent.environment, projectConfig.subagent.environment),
  };
  if (projectConfig.subagent.tools !== undefined) subagent.tools = projectConfig.subagent.tools;
  else if (globalConfig.subagent.tools !== undefined) subagent.tools = globalConfig.subagent.tools;
  else delete subagent.tools;

  const effortProfiles = {
    ...(globalConfig.fork.effortProfiles ?? {}),
    ...(projectConfig.fork.effortProfiles ?? {}),
  };
  const fork: ForkConfig = {
    ...DEFAULT_FORK_CONFIG,
    ...globalConfig.fork,
    ...projectConfig.fork,
    environment: mergeEnvironment(globalConfig.fork.environment, projectConfig.fork.environment),
    sandbox: {
      ...DEFAULT_SANDBOX_CONFIG,
      ...globalConfig.fork.sandbox,
      ...projectConfig.fork.sandbox,
    },
  };
  if (Object.keys(effortProfiles).length > 0) fork.effortProfiles = effortProfiles;
  else delete fork.effortProfiles;

  return { subagent, fork };
}
