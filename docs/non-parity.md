# Non-Parity Notes for the OpenClaw Port

This repo aims to be a **faithful port** of `davebcn87/pi-autoresearch`, but it will not be a literal 1:1 port of Pi's UI/runtime.

Pinned upstream reference:

- Repo: `https://github.com/davebcn87/pi-autoresearch`
- Commit: `2227029fa5712944a36938b5fe59f709cb30ed22` (`2227029f`)

## Principle

Non-parity is acceptable only when it is forced by the host/runtime difference.

That means:
- preserve semantics first
- preserve names and file layout second
- adapt presentation/runtime integration last

## Expected non-parity in v1

### 1. No Pi widget parity
The Pi extension renders an always-visible status widget above the editor.

OpenClaw may provide a thinner status surface instead, such as:
- tool output
- command output
- lightweight summaries

### 2. No fullscreen dashboard / TUI parity
Pi provides an inline dashboard with keyboard interaction.

OpenClaw v1 should not try to fake this with a new UI system. If a status view exists, it should be thin and optional.

### 3. No keyboard shortcut parity
Pi has `Ctrl+X` and `Escape` affordances tied to its editor runtime.

These are considered host-specific and are not part of the core port contract.

### 4. Lifecycle hook names will differ
Pi uses hooks such as:
- `session_start`
- `session_switch`
- `session_fork`
- `session_tree`
- `before_agent_start`
- `agent_end`
- `input`

OpenClaw has a different hook model. We should preserve intent, not literal event names.

In practice, this port now uses documented OpenClaw lifecycle hooks such as:
- `before_prompt_build`
- `message_received`
- `agent_end`
- `session_end`

The result should preserve queued-steer handling and ideas-backlog continuation intent without pretending that Pi's hook names or UI affordances exist in OpenClaw.

### 5. `/autoresearch` command is thinner than Pi
The upstream repo includes a dedicated `/autoresearch` dashboard/entry surface.

OpenClaw v1 keeps the main UX command-first and implements `/autoresearch` as a mode and status helper that:
- provides a stable explicit entrypoint when host-native skill aliases vary
- detects canonical repo-root files
- enables or disables autoresearch mode for later agent turns
- offers terse status text
- points the agent back to `autoresearch.md`

It is intentionally not a dashboard replacement or a fullscreen UI.

## Non-parity that is **not** acceptable

The following would be design drift, not justified non-parity:

- moving canonical runtime files under `.autoresearch/` in v1
- renaming `init_experiment`, `run_experiment`, or `log_experiment`
- making a provider/runtime the product identity
- replacing the explicit command and direct-skill setup surface with a provider-specific worker-first UX
- changing keep/discard/crash behavior for convenience
- relying on hidden runtime state instead of file-first resumability

## Honest product statement for v1

The correct way to describe v1 is:

> A faithful OpenClaw port of `pi-autoresearch` that preserves upstream semantics, names, and file contracts, while explicitly not matching Pi's editor widget/dashboard UX.

## Future parity work

Possible later work, if OpenClaw surfaces support it cleanly:
- richer status presentation
- optional command polish
- optional provider adapters behind the plugin boundary

These should remain secondary to semantic fidelity.
