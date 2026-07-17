import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSandboxedCommand, type ForkSandboxRuntimeConfig } from "../src/fork/sandbox.js";

const hasBwrap = (() => {
  try {
    execSync("command -v bwrap", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function runInSandbox(command: string, sandboxConfig?: Partial<ForkSandboxRuntimeConfig>): string {
  return execSync(buildSandboxedCommand(command, sandboxConfig), {
    encoding: "utf-8",
    env: {
      ...process.env,
      SHOULD_NOT_LEAK_TO_SANDBOX: "secret-value",
    },
  }).trim();
}

describe.skipIf(!hasBwrap)("sandbox integration", () => {
  it("allows repo reads and /tmp writes", () => {
    const out = runInSandbox("test -f package.json && touch /tmp/sandbox-ok && echo ok");

    expect(out).toBe("ok");
  });

  it("blocks repo writes", () => {
    expect(() => runInSandbox("touch SHOULD_FAIL")).toThrow(/Read-only file system/);
  });

  it("clears inherited environment", () => {
    const out = runInSandbox("printenv SHOULD_NOT_LEAK_TO_SANDBOX || true");

    expect(out).toBe("");
  });

  it("exposes normal home configuration while keeping home writes temporary", () => {
    const marker = `.pi-subagent-overlay-${process.pid}`;
    const markerPath = join(homedir(), marker);

    try {
      const out = runInSandbox(`touch "$HOME/${marker}" && printf %s "$HOME"`, {
        homeAccess: "overlay",
        homeDir: homedir(),
      });

      expect(out).toBe(homedir());
      expect(() => readFileSync(markerPath)).toThrow();
    } finally {
      rmSync(markerPath, { force: true });
    }
  });

  it("keeps advertised tmp files visible across bash and host tools", () => {
    const hostTmpDir = mkdtempSync(join(tmpdir(), "pi-subagent-host-tmp-"));
    const sandboxConfig = { tmpDir: hostTmpDir, hostTmpDir };

    try {
      runInSandbox("echo marker > $TMPDIR/marker", sandboxConfig);
      const out = runInSandbox("cat $TMPDIR/marker", sandboxConfig);
      const hostOut = readFileSync(join(hostTmpDir, "marker"), "utf-8").trim();

      expect(out).toBe("marker");
      expect(hostOut).toBe("marker");
    } finally {
      rmSync(hostTmpDir, { recursive: true, force: true });
    }
  });

  it("blocks shell network", () => {
    const out = runInSandbox("curl -fsS --max-time 2 https://example.com >/dev/null 2>&1 || echo blocked");

    expect(out).toBe("blocked");
  });
});
