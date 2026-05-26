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

| Scenario | Rule Type | Action |
|----------|-----------|--------|
| **Enforce coding standards** | `tool_call` | Block tools that don't follow conventions |
| **Prevent context bloat** | `tool_result` | Truncate large results |
| **Git discipline** | `agent_end` | Force commit at session end |
| **Redirect to better tools** | `tool_call` | Block grep, suggest code-graph |
| **Custom team rules** | All types | Project-specific guardrails |

## Best Practices

### ✅ Recommended
- Start with built-in rules, then add project-specific ones
- Use `warn` before `block` — give the agent a chance to learn
- Keep rule patterns simple and specific — regex is evaluated on every tool call
- Put project rules in `.pi/shepherd-rules/` for version control

### ❌ Not Recommended
- Don't use overly broad patterns — they'll match too many calls and slow things down
- Don't create contradictory rules (block + allow the same pattern)
- Don't rely on shepherd for security — it's a guide, not a sandbox

## Limitations

| Limitation | Detail |
|------------|--------|
| Regex only | Patterns use regex, not semantic understanding |
| No async rules | Rules must evaluate synchronously |
| Agent can bypass | Determined agents can ignore warnings |
| No persistence | Rule state resets between sessions |

## Architecture

```
pi-shepherd/
├── index.ts          # Entry: register hooks + rules engine
├── rules-engine.ts   # Pattern matching + action dispatch
├── rules/            # Built-in rule definitions
│   ├── grep.ts       # Redirect grep → code-graph
│   ├── line-limit.ts # Warn on large outputs
│   └── agent-end.ts  # Enforce git commit
├── types.ts          # Rule type definitions
└── package.json
```

**Dependencies**:
- `@pi-atelier/shared-utils` (bundled) — settings management
- `@earendil-works/pi-coding-agent` — ExtensionAPI (peer)

## License

MIT
