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
  fs.mkdirSync(dir, { recursive: true });
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

    expect(loadAgentsFromDir(dir, "user")).toEqual([
      {
        name: "interface-designer",
        description: "Designs one interface option.",
        tools: ["read", "grep", "find", "ls"],
        model: "test-model",
        thinking: "medium",
        systemPrompt: "Design exactly one option.",
        filePath: path.join(dir, "interface-designer.md"),
        source: "user",
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

    expect(loadAgentsFromDir(dir, "user")).toEqual([]);
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

    expect(loadAgentsFromDir(dir, "user")).toEqual([]);
  });
});

describe("discoverAgents", () => {
  it("loads user identities without reading untrusted project identities", () => {
    const cwd = makeTempDir();
    const userDir = path.join(makeTempDir(), "agents");
    const projectDir = path.join(cwd, ".pi", "agents");

    writeAgent(
      userDir,
      "interface-designer.md",
      `---
name: interface-designer
description: User identity.
tools: read
---

User prompt.
`,
    );

    writeAgent(
      projectDir,
      "interface-designer.md",
      `---
name: interface-designer
description: Project override.
tools: read, grep
---

Project prompt.
`,
    );

    const result = discoverAgents({ cwd, userAgentsDir: userDir, projectAgentsDir: projectDir, projectTrusted: false });

    expect(result.userAgentsDir).toBe(userDir);
    expect(result.projectAgentsDir).toBe(projectDir);
    expect(result.projectTrusted).toBe(false);
    expect(result.agents.map((agent) => [agent.name, agent.source, agent.description])).toEqual([
      ["interface-designer", "user", "User identity."],
    ]);
  });

  it("lets trusted project identities override user identities", () => {
    const cwd = makeTempDir();
    const userDir = path.join(makeTempDir(), "agents");
    const projectDir = path.join(cwd, ".pi", "agents");

    writeAgent(
      userDir,
      "interface-designer.md",
      `---
name: interface-designer
description: User identity.
tools: read
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

    writeAgent(
      projectDir,
      "interface-designer.md",
      `---
name: interface-designer
description: Project override.
tools: read, grep
---

Project prompt.
`,
    );

    const result = discoverAgents({ cwd, userAgentsDir: userDir, projectAgentsDir: projectDir, projectTrusted: true });

    expect(result.agents.map((agent) => [agent.name, agent.source, agent.description])).toEqual([
      ["interface-designer", "project", "Project override."],
      ["reviewer", "user", "User addition."],
    ]);
  });
});
