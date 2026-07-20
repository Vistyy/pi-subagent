import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBwrapArgs, buildSandboxedCommand, resolveCaBundlePath } from "../src/fork/sandbox.js";

function optionValues(args: string[], option: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === option) values.push(args[i + 1]);
  }
  return values;
}

describe("sandbox command wrapper", () => {
  it("builds bwrap args for read-only workspace and writable temp", () => {
    const args = buildBwrapArgs();

    expect(args).toContain("--unshare-all");
    expect(args).toContain("--unshare-net");
    expect(args).not.toContain("--share-net");
    expect(args).toEqual(expect.arrayContaining([
      "--ro-bind", "$PWD", "$PWD",
      "--chdir", "$PWD",
      "--tmpfs", "/tmp",
      "--tmpfs", "/var/tmp",
      "--dir", "/tmp/home",
      "--ro-bind-try", "/run/current-system", "/run/current-system",
      "--setenv", "HOME", "/tmp/home",
      "--setenv", "TMPDIR", "/tmp",
    ]));
  });

  it("can expose the workspace through a temporary writable overlay after its read-only bind", () => {
    const args = buildBwrapArgs({ workspaceAccess: "overlay" });
    const workspaceBind = args.indexOf("--ro-bind");
    const overlaySource = args.indexOf("--overlay-src", workspaceBind);

    expect(args.slice(overlaySource, overlaySource + 4)).toEqual([
      "--overlay-src", "$PWD",
      "--tmp-overlay", "$PWD",
    ]);
    expect(overlaySource).toBeGreaterThan(workspaceBind);
    expect(args.indexOf("--chdir")).toBeGreaterThan(overlaySource);
  });

  it("can expose the real home through a temporary writable overlay", () => {
    const args = buildBwrapArgs({ homeAccess: "overlay", homeDir: "/home/example" });

    expect(args).toEqual(expect.arrayContaining([
      "--overlay-src", "/home/example",
      "--tmp-overlay", "/home/example",
      "--setenv", "HOME", "/home/example",
    ]));
    expect(args).not.toEqual(expect.arrayContaining(["--dir", "/tmp/home"]));
    expect(args).not.toEqual(expect.arrayContaining(["--setenv", "HOME", "/tmp/home"]));
  });

  it("clears inherited env and binds only minimal /etc files by default", () => {
    const args = buildBwrapArgs();

    expect(args).toContain("--clearenv");
    expect(args).toEqual(expect.arrayContaining([
      "--setenv", "TERM", "${TERM:-xterm-256color}",
      "--setenv", "LANG", "${LANG:-C.UTF-8}",
      "--setenv", "LC_ALL", "${LC_ALL:-C.UTF-8}",
      "--setenv", "PATH", "${PATH:-/etc/profiles/per-user/$USER/bin:/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin}",
      "--ro-bind-try", "/etc/passwd", "/etc/passwd",
      "--ro-bind-try", "/etc/group", "/etc/group",
      "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
    ]));
    expect(optionValues(args, "--ro-bind-try")).not.toContain("/etc");
  });

  it("exposes the resolved public CA bundle without mounting broad /etc paths", () => {
    const args = buildBwrapArgs();
    const caBundlePath = resolveCaBundlePath();

    if (!caBundlePath) return;

    expect(args).toEqual(expect.arrayContaining([
      "--ro-bind-try", caBundlePath, "/tmp/pi-subagent-ca-bundle.crt",
      "--setenv", "SSL_CERT_FILE", "/tmp/pi-subagent-ca-bundle.crt",
      "--setenv", "GIT_SSL_CAINFO", "/tmp/pi-subagent-ca-bundle.crt",
      "--setenv", "NODE_EXTRA_CA_CERTS", "/tmp/pi-subagent-ca-bundle.crt",
    ]));
    expect(args.indexOf("--clearenv")).toBeLessThan(args.indexOf("SSL_CERT_FILE") - 1);
    expect(optionValues(args, "--ro-bind-try")).not.toContain("/etc/ssl");
    expect(optionValues(args, "--ro-bind-try")).not.toContain("/etc/pki");
    expect(optionValues(args, "--ro-bind-try")).not.toContain("/etc/static");
  });

  it("resolves CA bundle symlinks before exposing them", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagent-ca-"));
    const target = join(dir, "ca-bundle.crt");
    const link = join(dir, "linked-bundle.crt");
    writeFileSync(target, "certificate data");
    symlinkSync(target, link);

    expect(resolveCaBundlePath([join(dir, "missing.crt"), link])).toBe(realpathSync(target));
  });

  it("keeps normal user command paths visible read-only", () => {
    const args = buildBwrapArgs();

    expect(args).toEqual(expect.arrayContaining([
      "--ro-bind-try", "/home", "/home",
      "--ro-bind-try", "/root", "/root",
      "--ro-bind-try", "/etc/profiles", "/etc/profiles",
      "--ro-bind-try", "/run/wrappers", "/run/wrappers",
    ]));
  });

  it("allows arbitrary shell syntax by relying on the sandbox, not regex filtering", () => {
    const wrapped = buildSandboxedCommand("python - <<'PY'\nprint(1 + 1)\nPY\ncurl https://example.com");

    expect(wrapped).toContain("command -v bwrap");
    expect(wrapped).toContain("python - <<'\\''PY'\\''");
    expect(wrapped).toContain("curl https://example.com");
    expect(wrapped).toContain("--unshare-net");
  });

  it("can allow shell network separately from Pi offline mode", () => {
    const args = buildBwrapArgs({ bashNetwork: true });
    const wrapped = buildSandboxedCommand("curl https://example.com", { bashNetwork: true });

    expect(args).toContain("--share-net");
    expect(args).not.toContain("--unshare-net");
    expect(args).toEqual(expect.arrayContaining([
      "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
      "--ro-bind-try", "/etc/hosts", "/etc/hosts",
    ]));
    expect(wrapped).toContain("curl https://example.com");
  });

  it("can use a configured writable tmp dir", () => {
    const args = buildBwrapArgs({ tmpDir: "/tmp/pi-subagent" });
    const wrapped = buildSandboxedCommand("mktemp -d", { tmpDir: "/tmp/pi-subagent" });

    expect(args).toEqual(expect.arrayContaining([
      "--tmpfs", "/tmp",
      "--dir", "/tmp/pi-subagent",
      "--setenv", "TMPDIR", "/tmp/pi-subagent",
    ]));
    expect(wrapped).toContain("--dir \\\n  /tmp/pi-subagent");
    expect(wrapped).toContain("TMPDIR \\\n  /tmp/pi-subagent");
  });

  it("binds a per-fork host tmp dir to the configured tmp dir", () => {
    const hostTmpDir = mkdtempSync(join(tmpdir(), "pi-subagent-host-tmp-"));

    try {
      const args = buildBwrapArgs({ tmpDir: "/tmp/pi-subagent", hostTmpDir });
      const wrapped = buildSandboxedCommand("mktemp -d", { tmpDir: "/tmp/pi-subagent", hostTmpDir });
      const realHostTmpDir = realpathSync(hostTmpDir);

      expect(args).toEqual(expect.arrayContaining([
        "--tmpfs", "/tmp",
        "--dir", "/tmp/pi-subagent",
        "--bind", realHostTmpDir, "/tmp/pi-subagent",
        "--setenv", "TMPDIR", "/tmp/pi-subagent",
      ]));
      expect(wrapped).toContain(`--bind \\\n  ${realHostTmpDir} \\\n  /tmp/pi-subagent`);
    } finally {
      rmSync(hostTmpDir, { recursive: true, force: true });
    }
  });

  it("single-quotes commands safely", () => {
    const wrapped = buildSandboxedCommand("echo '$HOME' && echo done");

    expect(wrapped).toContain("bash -lc 'echo '\\''$HOME'\\'' && echo done'");
  });
});
