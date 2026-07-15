import { describe, expect, it } from "vitest";
import {
  buildChildEnv,
  PI_SUBAGENT_CHILD_ENV,
  PI_SUBAGENT_CHILD_KIND_ENV,
} from "../src/runner/env.js";

describe("buildChildEnv", () => {
  it("marks spawned Pi processes as fork children", () => {
    const env = buildChildEnv({}, {}, "linux", true, "fork");

    expect(env[PI_SUBAGENT_CHILD_ENV]).toBe("1");
    expect(env[PI_SUBAGENT_CHILD_KIND_ENV]).toBe("fork");
  });

  it("prevents configured environment from overriding child markers", () => {
    const env = buildChildEnv({
      [PI_SUBAGENT_CHILD_ENV]: "0",
      [PI_SUBAGENT_CHILD_KIND_ENV]: "subagent",
    }, {}, "linux", true, "fork");

    expect(env[PI_SUBAGENT_CHILD_ENV]).toBe("1");
    expect(env[PI_SUBAGENT_CHILD_KIND_ENV]).toBe("fork");
  });

  it("normalizes child marker casing on Windows", () => {
    const env = buildChildEnv({ pi_subagent_child: "0" }, {}, "win32", true, "fork");

    expect(env[PI_SUBAGENT_CHILD_ENV]).toBe("1");
    expect(env.pi_subagent_child).toBeUndefined();
  });
});
