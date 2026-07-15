# pi-subagent

Pi package for focused forks and constrained named subagents.

The package registers two tools:

```text
fork({ task, effort? })
subagent({ agent, task })
```

Each call starts exactly one child Pi process.
Use separate tool calls when independent children should run in parallel.
Pi executes those sibling tool calls in parallel.

The package does not expose batch, chain, queue, previous-output, per-call working-directory, or nested-delegation interfaces.

## Install locally

```bash
pi install /home/syzom/projects/pi-extensions/pi-subagent
```

For one-off testing:

```bash
pi -e /home/syzom/projects/pi-extensions/pi-subagent
```

## Fork

Fork starts from a filtered snapshot of the current active session context and returns one bounded report.

```json
{
  "task": "Inspect the runner and identify the cause of the failing smoke test.",
  "effort": "balanced"
}
```

`effort` is optional and accepts `fast`, `balanced`, or `deep`.
The code default is `balanced`.
Settings may select another default.

- `fast` inspects the minimum evidence needed for one reliable result.
- `balanced` connects directly relevant evidence, reasoning, trade-offs, and uncertainty.
- `deep` pressure-tests the answer with wider evidence, failure modes, and hidden assumptions.

Fork snapshots include user messages, visible assistant text, and active compaction context.
They exclude hidden reasoning, tool calls, tool results, Bash messages, custom messages, and branch summaries.

## Named Subagent

Subagent runs one predefined identity with a complete self-contained task.
It does not inherit the parent conversation.

```json
{
  "agent": "interface-designer",
  "task": "Design one small interface for the requested seam."
}
```

User identities live under:

```text
~/.pi/agent/agents/*.md
```

Project identities live under:

```text
.pi/agents/*.md
```

Project identities load only when the project is trusted.
Trusted project identities override user identities with the same `name`.
The tool does not accept ad hoc system prompts or generic identities.

Identity frontmatter has this shape:

```yaml
---
name: my-agent
description: What this identity does.
tools: read, grep, find, ls
model: optional-provider/optional-model-name
thinking: medium
---
```

The Markdown body is the identity system prompt.
`tools` is required so the identity remains the default authority for its child tools.

## Configuration

Use one `pi-subagent` namespace with separate Fork and Subagent policies.

```json
{
  "pi-subagent": {
    "fork": {
      "tools": "read,bash,grep,find,ls,web_search,web_fetch,web_content_get",
      "extensions": [
        "~/projects/pi-extensions/pi-subagent/sandbox.ts"
      ],
      "offline": true,
      "activation": {
        "command": "direnv",
        "args": ["exec", "{cwd}"]
      },
      "sandbox": {
        "bashNetwork": false,
        "tmpDir": "/tmp"
      },
      "costFooter": true,
      "defaultEffort": "balanced",
      "effortProfiles": {
        "fast": {
          "provider": "openai-codex",
          "id": "gpt-5.6-luna",
          "thinking": "low"
        },
        "balanced": {
          "provider": "openai-codex",
          "id": "gpt-5.6-luna",
          "thinking": "medium"
        },
        "deep": {
          "provider": "openai-codex",
          "id": "gpt-5.6-luna",
          "thinking": "high"
        }
      }
    },
    "subagent": {
      "extensions": [],
      "offline": true,
      "environment": {}
    }
  }
}
```

Global settings load from `~/.pi/agent/settings.json`.
Trusted project settings load from `.pi/settings.json` and override global values.
Relative extension paths resolve from the settings file directory.

Fork `tools` is tri-state:

| Value | Behavior |
| --- | --- |
| omitted or `null` | Inherit parent Pi tool flags. |
| `""` | Pass `--no-tools`. |
| `"read,bash"` | Pass the listed tools. |

Subagent `tools` is also tri-state, but omission uses the selected identity's frontmatter tools.

Extensions use this shape for either child kind:

| Value | Behavior |
| --- | --- |
| omitted or `[]` | Load no child extensions. |
| `null` | Use normal Pi extension discovery. |
| `["./extension"]` | Load only the listed child extensions. |

`offline` controls `PI_OFFLINE` for child Pi processes.
`environment` overlays child environment variables.
Fork `activation` optionally wraps child startup and replaces `{cwd}` with the current working directory.

## Optional Fork sandbox

Add `sandbox.ts` to `pi-subagent.fork.extensions` to guard exploratory Fork children.
The hook removes `edit` and `write` and wraps Bash with Bubblewrap.

The workspace is read-only.
A per-Fork temporary directory is writable and visible to both sandboxed Bash and host-mediated tools.
Normal system and user command paths remain visible read-only, including user-installed tools under `/home` and Nix profile paths.

`sandbox.bashNetwork` controls Bash network access independently from `offline`.
Host-mediated tools such as `web_search`, `web_fetch`, and `web_content_get` remain usable when Bash network access is disabled.

This sandbox is a workflow guardrail for ordinary exploratory work, not a hostile-code security boundary.

## Shared implementation

Fork and Subagent use one child-process runner for process spawning, environment handling, cancellation, JSON event parsing, progress, result normalization, usage capture, and cleanup.
Fork adds a filtered session snapshot and effort prompt.
Subagent adds a named identity prompt and identity policy.
