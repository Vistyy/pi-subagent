# Unify Fork and named subagents in pi-subagent

Status: In progress

Baseline: `4ba759a8330c575616e0e515bbe38b301f518c45`

## Capability

A single installed `pi-subagent` package exposes one-child Fork and named Subagent delegation without a second orchestration layer.

This is one atomic cutover slice because the highest verification seam is a fresh Pi process with one package registration and exactly the two supported tools.
Leaving predecessor packages active would create duplicate tool registrations, so package migration and contraction belong to the same green cutover.

## Public interface

```text
fork({ task, effort? })
subagent({ agent, task })
```

Pi parallel tool calls provide sibling concurrency.
The tools do not expose batch, chain, queue, previous-output, per-call working-directory, or nested-delegation interfaces.

## Scope

- Register `fork` and `subagent` from `pi-subagent`.
- Move Pi Fork's filtered session snapshot, effort contract, effort profiles, child runner, progress rendering, usage accounting, optional cost footer, and lightweight Bubblewrap Bash hook into `pi-subagent`.
- Keep the code-level Fork default at `balanced` and configure the active global override as `fast`.
- Preserve named identity discovery and identity-defined model, thinking, tools, and system prompts.
- Move settings under `pi-subagent.fork` and `pi-subagent.subagent`.
- Remove internal Subagent parallel and chain modes.
- Let separate Pi tool calls provide parallel execution for both tools.
- Keep only `pi-delegation`'s useful sandbox behavior: normal read-only host paths remain visible so user-installed read-only commands can run.
- Do not port `pi-delegation`'s custom host protocol, SDK runner, credential forwarding, runtime caps, execution plans, or sandbox architecture.
- Update active settings to install only `pi-subagent`.
- Remove the standalone `pi-fork` and `pi-delegation` directories after cutover verification.

## Acceptance criteria and verification seams

1. A package registration test observes exactly one `fork` and one `subagent` tool from `pi-subagent`.
2. The Fork tool schema accepts one `task` and optional `fast`, `balanced`, or `deep` effort, and omitted effort resolves to `balanced` before settings overrides.
3. Fork prompt tests preserve the lower-effort guidance and bounded child handoff contract from Pi Fork.
4. The Subagent tool schema requires exactly one `agent` and one `task` and has no batch, chain, previous-output, or `cwd` fields.
5. Runner tests demonstrate one child per tool invocation, filtered Fork context, named identity isolation, usage capture, cancellation behavior, and final-response validation.
6. Sandbox tests demonstrate a read-only workspace, writable per-fork temporary directory, and read-only visibility of normal host paths used by user commands.
7. Configuration tests demonstrate global and trusted-project precedence under `pi-subagent.fork` and `pi-subagent.subagent`.
8. `pnpm test` and `pnpm typecheck` pass in `pi-subagent`.
9. A fresh Pi smoke process loaded only from `pi-subagent` advertises `fork` and `subagent` without duplicate registrations.
10. `~/.pi/agent/settings.json` contains only the `pi-subagent` package and namespace for delegation.
11. The standalone `pi-fork` and `pi-delegation` extension directories are removed after the unified package is verified.

## Validation commands

```bash
pnpm test
pnpm typecheck
pi --no-session --no-extensions -e /home/syzom/projects/pi-extensions/pi-subagent --mode print -p "List the active delegation tool names only."
```

The authenticated smoke may be replaced by a deterministic extension registration smoke when provider access is unavailable.
