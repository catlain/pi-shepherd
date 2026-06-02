[中文文档](README.md) | [English](#)

> 📖 **[pi-atelier Guide](https://catlain.github.io/pi-atelier/)** — Learn the pi-atelier ecosystem from scratch

# pi-shepherd

[Repository](https://github.com/catlain/pi-shepherd) | [npm](https://www.npmjs.com/package/pi-shepherd)

A **rule-driven behavior guardian** for [pi-coding-agent](https://github.com/earendil-works/pi-coding-agent) — automatically intercepts, notifies, or rewrites operations at key points in the AI workflow: tool calls, AI responses, and session lifecycle events.

## What Problem Does It Solve

AI coding assistants tend to drift during long sessions:

- **Tool misuse**: Using grep for symbol searches (should use code-graph), using bash cat to read files (should use read)
- **Forgot to wrap up**: Not running tests after edits, not committing git, not updating docs
- **Coding standard violations**: Using spaces in TypeScript (should use tabs), using tabs in Python (should use spaces)
- **Repeating mistakes**: Same error recurring without checking existing pitfall records

pi-shepherd provides a **configurable rules engine** that automatically intervenes at these key points, turning best practices into automated guardrails.

## Installation

```bash
pi install git:github.com/catlain/pi-shepherd
```

## Core Concepts

### Hooks

Shepherd inserts hooks at 6 key points in the AI workflow:

| Hook | When | Typical Use |
|------|------|-------------|
| `tool_call` | Before tool execution | Block inappropriate calls, rewrite commands |
| `tool_result` | After tool execution | Check results, trigger follow-up actions |
| `agent_end` | When AI voluntarily stops | Remind to commit git, update memory |
| `message_end` | After each AI response | Detect problematic patterns in responses |
| `session_end` | When session ends | Session-level cleanup |
| `session_shutdown` | When session shuts down | Resource cleanup |

### Actions

4 actions available when a rule matches:

| Action | Effect |
|--------|--------|
| `block` | Prevent tool execution, return reason |
| `notify` | Show reminder, AI can choose to ignore |
| `steer` | Inject into next turn, forcing AI to respond |
| `rewrite` | Rewrite tool parameters then continue |

### Condition Matching

**Single condition** (simple cases):
```json
{ "pattern": "\\bcat\\b", "flags": "" }
```

**Multiple conditions** (precise control):
```json
{
  "conditions": [
    { "field": "path", "pattern": "\\.ts$" },
    { "field": "text", "pattern": "\\n  [\\S ]" }
  ]
}
```

Multiple `conditions` are **AND** by default (all must match). Use `conditionLogic: "or"` for OR.

**Built-in conditions** (no regex needed):

| builtin | Checks |
|---------|--------|
| `git_dirty` | Has uncommitted changes in tracked files |
| `git_untracked` | Has untracked files |
| `has_edits` | edit/write was called this turn |
| `always` | Always matches |

### Stateful Rules

Track tool call statistics via the `state` field for patterns like "remind after N errors":

```json
{
  "comment": "Remind to check memory after repeated errors",
  "hook": "tool_result",
  "action": "steer",
  "state": { "countKind": "errors", "gte": 5 },
  "reason": "Tool keeps failing — check memory files for known pitfalls"
}
```

Three counting modes:
- `calls`: Tool invocation count
- `errors`: Consecutive error count
- `chars`: Tool result character count

Use `resetOn` to reset counters when a specific tool succeeds (e.g., clear error count after tests pass).

## Rule Format

Complete rule fields:

```json
{
  "comment": "Rule description (required, also serves as unique ID)",
  "hook": "tool_call",
  "tool": "bash",
  "action": "block",
  "reason": "Message shown to AI",
  "pattern": "\\bcat\\b",
  "conditions": [{ "field": "path", "pattern": "\\.ts$" }],
  "conditionLogic": "and",
  "enabled": true,
  "state": { "countKind": "errors", "gte": 3 },
  "resetOn": ["bash"],
  "subagent": false,
  "requiresTools": ["code_graph_semantic_code_search"],
  "requireSuccess": true,
  "stopReason": ["stop"]
}
```

**Required fields**: `comment`, `reason`

**Optional fields**:
- `enabled`: `false` to disable (default `true`, can be omitted)
- `subagent`: `false` to skip in subagent sessions
- `requiresTools`: Only trigger when all listed tools are available
- `requireSuccess`: `true` to skip `isError` tool_results
- `stopReason`: For `agent_end` only, limit to specific end reasons

## Rule Locations

**Global rules**: `~/.pi/agent/extensions/shepherd/rules.json` (applies to all projects)

**Project rules**: `{cwd}/.pi/extensions/shepherd-rules.json` (current project only)
Or `{cwd}/.pi/extensions/shepherd-rules-*.json` (multiple files)

Project and global rules are merged. Project rules can supplement or override global rules.

## Managing Rules

Use the `shepherd_rules` tool for safe editing (auto-validates, backs up, and verifies):

```
# List all rules
shepherd_rules(action: "list")

# Add a rule
shepherd_rules(action: "add", rule: { comment: "...", hook: "...", ... })

# Update a rule
shepherd_rules(action: "update", index: 2, changes: { enabled: false })

# Delete a rule
shepherd_rules(action: "delete", index: 3)
```

## Practical Examples

### 1. Auto-run tests after editing Python

```json
{
  "comment": "Run tests after Python edit",
  "hook": "tool_result",
  "tool": "edit",
  "action": "notify",
  "conditions": [{ "field": "path", "pattern": "\\.py$" }],
  "reason": "Python file edited — please run ruff check and unit tests"
}
```

### 2. Check git status before session ends

```json
{
  "comment": "Check git before session end",
  "hook": "agent_end",
  "action": "notify",
  "conditions": [
    { "builtin": "git_dirty" },
    { "builtin": "git_untracked" }
  ],
  "conditionLogic": "or",
  "reason": "Git has uncommitted changes — please confirm if commit + push is needed"
}
```

### 3. Redirect grep to code-graph for code search

```json
{
  "comment": "Recommend code-graph over grep",
  "hook": "tool_result",
  "tool": "grep",
  "action": "notify",
  "pattern": ".",
  "reason": "Use code-graph for code search: semantic_code_search (fuzzy), get_ast_node (exact), find_references (refs)",
  "requiresTools": ["code_graph_semantic_code_search"]
}
```

### 4. Block attribution guessing in AI responses

```json
{
  "comment": "Block attribution guessing",
  "hook": "message_end",
  "action": "steer",
  "pattern": "(probably|might be|guess|likely).*(jiti|cache|toolchain)",
  "reason": "Don't guess root causes — check your code logic first, search for best practices, verify before concluding"
}
```

### 5. Block direct settings.json editing

```json
{
  "comment": "Block direct settings.json editing",
  "hook": "tool_call",
  "tool": "edit|write",
  "action": "block",
  "conditions": [{ "field": "path", "pattern": "settings\\.json$" }],
  "reason": "Directly editing settings.json caused config loss before — use settings_patch tool instead"
}
```

## Architecture

```
pi-shepherd/
├── index.ts              # Entry: register all hooks
├── shepherd/
│   ├── rules.ts          # Rule types + load/compile/match
│   ├── conditions.ts     # Condition types + builtin matching
│   ├── state-tracker.ts  # Stateful rule state tracker
│   ├── tool-hooks.ts     # tool_call / tool_result hook handlers
│   ├── message-end.ts    # message_end hook handler
│   ├── rules-tool.ts     # shepherd_rules tool registration
│   ├── rules-editor.ts   # Safe rule file editing (backup+validate)
│   ├── rules-validate.ts # Rule format validation
│   ├── ephemeral.ts      # Warning buffer (pushWarning)
│   ├── git.ts            # Git status check utilities
│   └── worktree-check.ts # Worktree environment detection
├── rules.json            # Default global rules
└── tests/                # Tests
```

**Dependencies**:
- `@pi-atelier/shared-utils` — Config API, tool output formatting
- `@earendil-works/pi-coding-agent` — ExtensionAPI (peer)

## License

MIT
