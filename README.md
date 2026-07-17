# pi-subagent

Pi package for focused forks and constrained named subagents.

This documentation describes `pi-subagent` v0.4.0.

## Tools

The package registers two tools:

```text
fork({ task, effort? })
subagent({ agent, task })
```

Each tool call starts exactly one child Pi process.
Both tools use Pi's parallel execution mode.
Run independent children as separate `fork` or `subagent` calls so Pi can execute them concurrently.

The package does not expose batch, chain, queue, previous-output, per-call working-directory, or nested-delegation interfaces.

## Install

Install the v0.3.1 release from GitHub:

```bash
pi install git:github.com/Vistyy/pi-subagent@v0.4.0
```

Install a local development checkout:

```bash
pi install /home/syzom/projects/pi-extensions/pi-subagent
```

Run a local checkout without installing it:

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
The built-in default is `balanced`.
`pi-subagent.fork.defaultEffort` can override that default.

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

## Tool-call display

Collapsed results show status and up to the three most recent child activities.
When more activities exist, an earlier-activity count shows how many were omitted.

The collapsed per-child footer shows elapsed duration and, when available, turns, input and output tokens, cache reads and writes, cost, context usage, provider, model, and thinking level.
Named identity and source provenance remain available in the expanded result without repeating them in the collapsed completion line.

Expanded results show the task, complete stored activity list, final output, errors, and the same per-child footer.
The package does not add an aggregate session-cost footer.

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
        "homeAccess": "isolated",
        "tmpDir": "/tmp"
      },
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
Project settings and project identities load from `.pi/` only when the project is trusted.
Trusted project settings override global values.

Relative extension paths resolve from the settings file containing them.
Paths beginning with `~/` resolve from the user's home directory.

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

The optional sandbox is Fork-specific and is not automatically applied to named Subagent processes.
Add `sandbox.ts` to `pi-subagent.fork.extensions` to guard exploratory Fork children.

The extension blocks `edit` and `write` child tool calls.
It wraps child Bash commands with Bubblewrap.

The workspace is read-only.
A per-Fork temporary directory is writable and visible to both sandboxed Bash and host-mediated tools.
Normal system and user command paths remain visible read-only, including user-installed tools under `/home` and Nix profile paths.

`sandbox.homeAccess` controls the home directory seen by sandboxed Bash.
The default `"isolated"` mode uses an empty temporary home.
The `"overlay"` mode exposes the user's normal home and keeps home writes in a temporary overlay that disappears with the Fork.
Overlay mode lets existing CLI configuration and credentials work normally, so Forks receive the same remote-account authority as the user.

`sandbox.bashNetwork` controls Bash network access independently from `offline`.
Host-mediated tools such as `web_search`, `web_fetch`, and `web_content_get` remain usable when Bash network access is disabled.

This sandbox is a workflow guardrail for ordinary exploratory work, not a hostile-code security boundary.

## Migration from separate packages

Remove the standalone `pi-fork` package registration.
Move its settings under `pi-subagent.fork`.
Move the previous top-level `pi-subagent` child settings under `pi-subagent.subagent`.
Reload Pi after changing package registration or settings.

The `pi-fork` GitHub repository is archived.

## Shared implementation

Fork and Subagent use one child-process runner for process spawning, environment handling, cancellation, JSON event parsing, progress, result normalization, duration tracking, usage capture, and cleanup.
Fork adds a filtered session snapshot and effort prompt.
Subagent adds a named identity prompt and identity policy.
