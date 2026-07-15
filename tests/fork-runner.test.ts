import { describe, expect, it } from "vitest";
import { buildForkArgs } from "../src/fork/runner/index.js";

const inherited = {
  alwaysProxy: [],
  fallbackModel: undefined,
  fallbackThinking: undefined,
  fallbackTools: undefined,
  fallbackNoTools: false,
};

describe("buildForkArgs", () => {
  it("disables child extensions by default when extensions is an array", () => {
    expect(buildForkArgs("task", "/tmp/session.jsonl", [], undefined, inherited)).toContain("--no-extensions");
  });

  it("preserves normal Pi extension discovery for explicit null", () => {
    expect(buildForkArgs("task", "/tmp/session.jsonl", null, undefined, inherited)).not.toContain("--no-extensions");
  });

  it("allowlists explicit child extensions", () => {
    const args = buildForkArgs("task", "/tmp/session.jsonl", ["/x/ext"], undefined, inherited);
    expect(args).toEqual(expect.arrayContaining(["--no-extensions", "--extension", "/x/ext"]));
  });

  it("uses configured child tools before inherited tools", () => {
    const args = buildForkArgs("task", "/tmp/session.jsonl", [], undefined, {
      ...inherited,
      fallbackTools: "read,bash,edit,write",
    }, undefined, "read,bash,grep,find,ls,web_search,web_fetch,web_content_get");

    expect(args).toEqual(expect.arrayContaining([
      "--tools", "read,bash,grep,find,ls,web_search,web_fetch,web_content_get",
    ]));
    expect(args).not.toEqual(expect.arrayContaining([
      "--tools", "read,bash,edit,write",
    ]));
  });

  it("supports configured no-tools", () => {
    const args = buildForkArgs("task", "/tmp/session.jsonl", [], undefined, inherited, undefined, "");
    expect(args).toContain("--no-tools");
  });

  it("applies effort profile model flags", () => {
    const args = buildForkArgs("task", "/tmp/session.jsonl", [], {
      provider: "openai-codex",
      id: "gpt-5.5",
      thinking: "high",
    }, inherited);

    expect(args).toEqual(expect.arrayContaining([
      "--provider", "openai-codex",
      "--model", "gpt-5.5",
      "--thinking", "high",
    ]));
  });
});
