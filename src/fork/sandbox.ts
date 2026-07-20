import { existsSync, realpathSync } from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_SANDBOX_CONFIG, loadConfig, type ForkSandboxConfig } from "../config.js";
import {
  PI_SUBAGENT_FORK_SANDBOX_HOST_TMPDIR_ENV,
  PI_SUBAGENT_FORK_SANDBOX_TMPDIR_ENV,
} from "../runner/env.js";

const DEFAULT_SANDBOX_PATH = "/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin";
const SANDBOX_PATH_EXPR = `\${PATH:-${DEFAULT_SANDBOX_PATH}}`;

const RAW_SHELL_ARGS = new Set([
  "$PWD",
  "${TERM:-xterm-256color}",
  "${LANG:-C.UTF-8}",
  "${LC_ALL:-C.UTF-8}",
  DEFAULT_SANDBOX_PATH,
  SANDBOX_PATH_EXPR,
]);

const CA_BUNDLE_SANDBOX_PATH = "/tmp/pi-subagent-ca-bundle.crt";
const CA_BUNDLE_ENV_KEYS = [
  "SSL_CERT_FILE",
  "NIX_SSL_CERT_FILE",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
];

export interface ForkSandboxRuntimeConfig extends ForkSandboxConfig {
  /** Host temp directory bound to tmpDir for the lifetime of one fork. */
  hostTmpDir?: string;

  /** Real user home exposed when homeAccess is overlay. */
  homeDir?: string;
}

function defaultCaBundleCandidates(): string[] {
  return [
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/certs/ca-bundle.crt",
    "/nix/var/nix/profiles/default/etc/ssl/certs/ca-bundle.crt",
  ];
}

export function resolveCaBundlePath(candidates: string[] = defaultCaBundleCandidates()): string | undefined {
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return realpathSync(candidate);
    } catch {
      // Ignore broken symlinks and unreadable candidates.
    }
  }
  return undefined;
}

function caBundleBindArgs(caBundlePath: string | undefined): string[] {
  if (!caBundlePath) return [];
  return ["--ro-bind-try", caBundlePath, CA_BUNDLE_SANDBOX_PATH];
}

function caBundleEnvArgs(caBundlePath: string | undefined): string[] {
  if (!caBundlePath) return [];
  return CA_BUNDLE_ENV_KEYS.flatMap((key) => ["--setenv", key, CA_BUNDLE_SANDBOX_PATH]);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellArg(value: string): string {
  if (value === "$PWD") return '"$PWD"';
  if (RAW_SHELL_ARGS.has(value)) return value.includes("$") ? `"${value}"` : value;
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
}

function isSandboxTmpDir(value: string): boolean {
  return value === "/tmp" || value.startsWith("/tmp/") || value === "/var/tmp" || value.startsWith("/var/tmp/");
}

function normalizeSandboxTmpDir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const tmpDir = path.posix.normalize(value.trim());
  return isSandboxTmpDir(tmpDir) ? tmpDir : undefined;
}

function resolveHostPath(value: string | undefined): string | undefined {
  if (!value || !path.isAbsolute(value)) return undefined;
  try {
    return existsSync(value) ? realpathSync(value) : undefined;
  } catch {
    return undefined;
  }
}

function resolveSandboxConfig(overrides: Partial<ForkSandboxRuntimeConfig> = {}): ForkSandboxRuntimeConfig {
  return { ...DEFAULT_SANDBOX_CONFIG, ...overrides };
}

function runtimeSandboxConfig(baseConfig: ForkSandboxConfig): ForkSandboxRuntimeConfig {
  const tmpDir = normalizeSandboxTmpDir(process.env[PI_SUBAGENT_FORK_SANDBOX_TMPDIR_ENV]) || baseConfig.tmpDir;
  const hostTmpDir = resolveHostPath(process.env[PI_SUBAGENT_FORK_SANDBOX_HOST_TMPDIR_ENV]);
  const homeDir = baseConfig.homeAccess === "overlay" ? resolveHostPath(process.env.HOME) : undefined;
  return { ...baseConfig, tmpDir, hostTmpDir, homeDir };
}

function dirArgsForPath(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  const dirs: string[] = [];
  let current = "";

  for (const part of parts) {
    current += `/${part}`;
    if (current !== "/tmp" && current !== "/var" && current !== "/var/tmp") dirs.push(current);
  }

  return dirs.flatMap((value) => ["--dir", value]);
}

function tmpDirArgs(tmpDir: string): string[] {
  if (["/tmp", "/var/tmp", "/tmp/home"].includes(tmpDir)) return [];
  return dirArgsForPath(tmpDir);
}

function writableTmpMountArgs(config: ForkSandboxRuntimeConfig): string[] {
  const hostTmpDir = resolveHostPath(config.hostTmpDir);
  if (!hostTmpDir) {
    return [
      "--tmpfs", "/tmp",
      "--tmpfs", "/var/tmp",
      ...tmpDirArgs(config.tmpDir),
    ];
  }

  const args: string[] = [];
  if (config.tmpDir === "/tmp") args.push("--bind", hostTmpDir, "/tmp");
  else args.push("--tmpfs", "/tmp");

  if (config.tmpDir === "/var/tmp") args.push("--bind", hostTmpDir, "/var/tmp");
  else args.push("--tmpfs", "/var/tmp");

  if (config.tmpDir !== "/tmp" && config.tmpDir !== "/var/tmp") {
    args.push(...dirArgsForPath(config.tmpDir), "--bind", hostTmpDir, config.tmpDir);
  }

  return args;
}

export function buildBwrapArgs(sandboxConfig: Partial<ForkSandboxRuntimeConfig> = {}): string[] {
  const config = resolveSandboxConfig(sandboxConfig);
  const caBundlePath = resolveCaBundlePath();
  const homeDir = config.homeAccess === "overlay" ? config.homeDir : undefined;
  return [
    "--die-with-parent",
    "--unshare-all",
    config.bashNetwork ? "--share-net" : "--unshare-net",
    "--new-session",
    "--ro-bind-try", "/nix", "/nix",
    "--ro-bind-try", "/usr", "/usr",
    "--ro-bind-try", "/bin", "/bin",
    "--ro-bind-try", "/sbin", "/sbin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/home", "/home",
    "--ro-bind-try", "/root", "/root",
    "--ro-bind-try", "/opt", "/opt",
    "--ro-bind-try", "/mnt", "/mnt",
    "--ro-bind-try", "/media", "/media",
    "--ro-bind-try", "/srv", "/srv",
    "--ro-bind-try", "/etc/profiles", "/etc/profiles",
    "--ro-bind-try", "/run/wrappers", "/run/wrappers",
    "--ro-bind-try", "/etc/passwd", "/etc/passwd",
    "--ro-bind-try", "/etc/group", "/etc/group",
    "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
    ...(config.bashNetwork
      ? [
          "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
          "--ro-bind-try", "/etc/hosts", "/etc/hosts",
        ]
      : []),
    "--ro-bind-try", "/run/current-system", "/run/current-system",
    ...(homeDir ? ["--overlay-src", homeDir, "--tmp-overlay", homeDir] : []),
    "--proc", "/proc",
    "--dev", "/dev",
    ...writableTmpMountArgs(config),
    ...caBundleBindArgs(caBundlePath),
    ...(homeDir || config.tmpDir === "/tmp/home" ? [] : ["--dir", "/tmp/home"]),
    "--ro-bind", "$PWD", "$PWD",
    ...(config.workspaceAccess === "overlay" ? ["--overlay-src", "$PWD", "--tmp-overlay", "$PWD"] : []),
    "--chdir", "$PWD",
    "--clearenv",
    ...caBundleEnvArgs(caBundlePath),
    "--setenv", "HOME", homeDir || "/tmp/home",
    "--setenv", "TMPDIR", config.tmpDir,
    "--setenv", "TERM", "${TERM:-xterm-256color}",
    "--setenv", "LANG", "${LANG:-C.UTF-8}",
    "--setenv", "LC_ALL", "${LC_ALL:-C.UTF-8}",
    "--setenv", "PATH", SANDBOX_PATH_EXPR,
  ];
}

function renderBwrapCommand(args: string[], command: string): string {
  const renderedArgs = args.map((arg) => `  ${shellArg(arg)} \\`).join("\n");
  return `if ! command -v bwrap >/dev/null 2>&1; then
  echo "Fork agent: bwrap is required for bash sandboxing but was not found." >&2
  exit 126
fi

bwrap \\
${renderedArgs}
  bash -lc ${shellQuote(command)}`;
}

export function buildSandboxedCommand(
  command: string,
  sandboxConfig: Partial<ForkSandboxRuntimeConfig> = {},
): string {
  return renderBwrapCommand(buildBwrapArgs(sandboxConfig), command);
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "edit" || event.toolName === "write") {
      return {
        block: true,
        reason: "Fork agent: file modification is not allowed.",
      };
    }

    if (event.toolName === "bash") {
      const command = typeof event.input?.command === "string" ? event.input.command : "";
      const config = runtimeSandboxConfig(loadConfig(ctx.cwd, ctx.isProjectTrusted()).fork.sandbox);
      event.input.command = buildSandboxedCommand(command, config);
    }

    return undefined;
  });
}
