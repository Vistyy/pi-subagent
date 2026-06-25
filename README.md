# pi-subagent

Pi package for constrained named subagents.

It registers a `subagent` tool that only runs defined identities.

Identities can come from:

1. bundled identities in this package:

   ```text
   agents/*.md
   ```

2. optional user overrides or additions:

   ```text
   ~/.pi/agent/agents/*.md
   ```

User identities override bundled identities with the same `name`.

The tool does not support ad hoc system prompts, generic agents, or project-local agents.

## Install locally

```bash
pi install /home/syzom/projects/pi-extensions/pi-subagent
```

Local installs are stored in `~/.pi/agent/settings.json` and loaded from this checkout.

## Install from git

```bash
pi install git:github.com/Vistyy/pi-subagent@v0.1.0
```

## Configure child processes

Use the `pi-subagent` key in global or project settings.

```json
{
  "pi-subagent": {
    "tools": "read,bash,grep,find,ls,web_search,web_fetch,web_content_get",
    "extensions": [],
    "offline": true,
    "environment": {
      "EXAMPLE": "value"
    }
  }
}
```

`tools` controls child Pi tools:

| value | behavior |
| --- | --- |
| omitted | use the selected identity's frontmatter `tools` |
| `null` | let child Pi use normal tool behavior |
| `""` | pass `--no-tools` |
| `"read,bash"` | pass `--tools read,bash` |

`extensions` follows the same shape as `pi-fork`:

| value | behavior |
| --- | --- |
| omitted or `[]` | no child extensions |
| `null` | normal Pi extension discovery |
| `["./path/to/extension"]` | only the listed child extensions |

Relative extension paths resolve from the settings file directory.

`offline` controls `PI_OFFLINE` for child Pi processes.

`environment` overlays environment variables for child Pi processes.

## Add a local identity

Create a Markdown file under:

```text
~/.pi/agent/agents/
```

Use frontmatter:

```yaml
---
name: my-agent
description: What this identity does.
tools: read, grep, find, ls
model: optional-provider/optional-model-name
thinking: medium
---
```

The body is the subagent system prompt.

`tools` is required so an identity never accidentally gets all tools when `pi-subagent.tools` is omitted.

`thinking` is optional and supports `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

## Bundled identity

```text
agents/interface-designer.md
```
