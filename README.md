# pi-shepherd

Line count guard and behavior rules extension for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — rule-driven hooks for tool calls, agent end, and session events.

## What It Does

AI agents can go off the rails — generate too much code, forget to commit, ignore coding standards, or produce outputs that are too large. pi-shepherd acts as a **guardrail system** that monitors and enforces behavioral rules:

- **Tool call interception** — Inspect and modify tool calls before execution (e.g., enforce line limits)
- **Tool result inspection** — Check tool results after execution (e.g., flag overly large outputs)
- **Agent end hooks** — Enforce commit/message rules when the agent finishes
- **Session lifecycle** — Reset state between sessions

## Installation

```bash
pi install git:github.com/catlain/pi-shepherd
```

## How It Works

pi-shepherd uses a **rules engine** that evaluates configurable patterns against tool calls and results:

```
Tool Call → Rules Engine → Pass/Block/Modify
Tool Result → Rules Engine → Pass/Flag/Truncate
Agent End → Rules Engine → Enforce (commit, summarize, etc.)
```

### Rules Format

Rules are defined in `rules.json` (or the `shepherd` section of settings):

```json
[
  {
    "name": "block-grep-for-code-graph",
    "pattern": "^grep\\s+.*\\b[A-Z][a-zA-Z]+\\(",
    "type": "tool_call",
    "action": "block",
    "message": "Use code-graph search_symbols instead of grep for symbol names"
  },
  {
    "name": "warn-large-edit",
    "pattern": "edit",
    "type": "tool_result",
    "maxLines": 500,
    "action": "warn",
    "message": "Edit result is large, consider breaking into smaller changes"
  }
]
```

### Rule Types

| Type | When Evaluated | Actions |
|------|---------------|---------|
| `tool_call` | Before tool execution | `pass`, `block`, `modify` |
| `tool_result` | After tool execution | `pass`, `warn`, `truncate` |
| `agent_end` | When agent finishes | `enforce` |

## Built-in Rules

pi-shepherd ships with default rules for common anti-patterns:

- Redirect `grep` to `code-graph` for symbol searches
- Warn on overly large tool results
- Enforce git commit on agent end
- Block redundant file reads

## Configuration

```json
{
  "shepherd": {
    "enabled": true,
    "rulesDir": "~/.pi/agent/shepherd-rules"
  }
}
```

## Use Cases

- **Enforce coding standards** — Block tools that don't follow project conventions
- **Prevent context bloat** — Truncate large tool results before they enter context
- **Ensure git discipline** — Force commits at session end
- **Custom guardrails** — Write project-specific rules for your team

## Dependencies

- `@pi-atelier/shared-utils` (bundled) — settings management
- `@earendil-works/pi-coding-agent` — ExtensionAPI (peer)

## License

MIT
