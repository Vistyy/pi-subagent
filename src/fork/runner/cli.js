/**
 * Parse the small set of parent CLI flags that should affect child Pi runs.
 *
 * Unknown flags are intentionally not forwarded. Fork children should inherit
 * only stable runtime settings, not every parent startup option.
 */
import * as os from "node:os";
import * as path from "node:path";

function resolvePathArg(value, alwaysResolveRelative = false) {
  if (!value) return value;
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return alwaysResolveRelative ? path.resolve(process.cwd(), value) : value;
}

export function parseInheritedCliArgs(argv) {
  const alwaysProxy = [];
  let fallbackModel;
  let fallbackThinking;
  let fallbackTools;
  let fallbackNoTools = false;

  let i = 2;
  while (i < argv.length) {
    const raw = argv[i];
    if (!raw.startsWith("-")) {
      i++;
      continue;
    }

    const eqIdx = raw.indexOf("=");
    const flagName = eqIdx !== -1 ? raw.slice(0, eqIdx) : raw;
    const inlineValue = eqIdx !== -1 ? raw.slice(eqIdx + 1) : undefined;
    const nextToken = argv[i + 1];
    const nextIsValue = nextToken !== undefined && !nextToken.startsWith("-");

    const getValue = () => {
      if (inlineValue !== undefined) return [inlineValue, 1];
      if (nextIsValue) return [nextToken, 2];
      return [undefined, 1];
    };

    if (flagName === "--session-dir") {
      const [value, skip] = getValue();
      if (value !== undefined) alwaysProxy.push(flagName, resolvePathArg(value, true));
      i += skip;
      continue;
    }

    if (["--provider", "--api-key", "--models"].includes(flagName)) {
      const [value, skip] = getValue();
      if (value !== undefined) alwaysProxy.push(flagName, value);
      i += skip;
      continue;
    }

    if (["--no-skills", "-ns", "--no-prompt-templates", "-np", "--no-themes"].includes(flagName)) {
      alwaysProxy.push(flagName);
      i++;
      continue;
    }

    if (flagName === "--model") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackModel = value;
      i += skip;
      continue;
    }

    if (flagName === "--thinking") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackThinking = value;
      i += skip;
      continue;
    }

    if (flagName === "--tools") {
      const [value, skip] = getValue();
      if (value !== undefined) fallbackTools = value;
      i += skip;
      continue;
    }

    if (flagName === "--no-tools") {
      fallbackNoTools = true;
      i++;
      continue;
    }

    const [, skip] = getValue();
    i += skip;
  }

  return {
    alwaysProxy,
    fallbackModel,
    fallbackThinking,
    fallbackTools,
    fallbackNoTools,
  };
}
