import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverAgents, loadAgentsFromDir } from "../src/agents.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeAgent(dir: string, fileName: string, content: string) {
  fs.writeFileSync(path.join(dir, fileName), content, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadAgentsFromDir", () => {
  it("loads valid defined identities", () => {
    const dir = makeTempDir();
    writeAgent(
      dir,
      "interface-designer.md",
      `---
name: interface-designer
description: Designs one interface option.
tools: read, grep, find, ls
model: test-model
thinking: medium
---

Design exactly one option.
`,
    );

    expect(loadAgentsFromDir(dir, "bundled")).toEqual([
      {
        name: "interface-designer",
        description: "Designs one interface option.",
        tools: ["read", "grep", "find", "ls"],
        model: "test-model",
        thinking: "medium",
        systemPrompt: "Design exactly one option.",
        filePath: path.join(dir, "interface-designer.md"),
        source: "bundled",
      },
    ]);
  });

  it("requires an explicit tool list", () => {
    const dir = makeTempDir();
    writeAgent(
      dir,
      "generic.md",
      `---
name: generic
description: Missing tools.
---

No tool list.
`,
    );

    expect(loadAgentsFromDir(dir, "bundled")).toEqual([]);
  });

  it("rejects invalid identity names", () => {
    const dir = makeTempDir();
    writeAgent(
      dir,
      "bad.md",
      `---
name: Generic Worker
description: Bad name.
tools: read
---

Bad identity.
`,
    );

    expect(loadAgentsFromDir(dir, "bundled")).toEqual([]);
  });
});

describe("discoverAgents", () => {
  it("loads bundled identities and user overrides", () => {
    const bundledDir = makeTempDir();
    const userDir = makeTempDir();

    writeAgent(
      bundledDir,
      "interface-designer.md",
      `---
name: interface-designer
description: Bundled identity.
tools: read
---

Bundled prompt.
`,
    );

    writeAgent(
      userDir,
      "interface-designer.md",
      `---
name: interface-designer
description: User override.
tools: read, grep
---

User prompt.
`,
    );

    writeAgent(
      userDir,
      "reviewer.md",
      `---
name: reviewer
description: User addition.
tools: read
---

Review prompt.
`,
    );

    const result = discoverAgents({ bundledAgentsDir: bundledDir, userAgentsDir: userDir });

    expect(result.bundledAgentsDir).toBe(bundledDir);
    expect(result.userAgentsDir).toBe(userDir);
    expect(result.agents.map((agent) => [agent.name, agent.source, agent.description])).toEqual([
      ["interface-designer", "user", "User override."],
      ["reviewer", "user", "User addition."],
    ]);
  });
});
