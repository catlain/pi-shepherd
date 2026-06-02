[English](README.en.md) | [中文文档](#)

> 📖 **[pi-atelier 实战指南](https://catlain.github.io/pi-atelier/)** — 从零教会你使用 pi-atelier 扩展生态

# pi-shepherd

[源码仓库](https://github.com/catlain/pi-shepherd) | [npm](https://www.npmjs.com/package/pi-shepherd)

pi-coding-agent 的 **规则驱动行为守护系统** — 在工具调用、AI 回复、会话结束等关键节点，自动拦截、提醒或改写操作。

## 解决什么问题

AI 编程助手在长时间会话中容易跑偏：

- **工具滥用**：用 grep 搜符号名（应该用 code-graph）、用 bash cat 读文件（应该用 read）
- **忘记收尾**：改完代码不跑测试、不提交 git、不更新文档
- **编码规范违反**：TypeScript 用空格缩进（应该用 Tab）、Python 用 Tab（应该用空格）
- **重复犯错**：同一个错误反复出现，不知道翻看已有的踩坑记录

pi-shepherd 通过**可配置的规则引擎**，在这些关键节点自动介入，把最佳实践变成自动化的守护机制。

## 安装

```bash
pi install git:github.com/catlain/pi-shepherd
```

## 核心概念

### 钩子（Hook）

Shepherd 在 AI 工作流的 6 个关键节点插入钩子：

| 钩子 | 触发时机 | 典型用途 |
|------|---------|---------|
| `tool_call` | 工具即将执行前 | 拦截不当调用、改写命令 |
| `tool_result` | 工具执行完成后 | 检查结果、触发后续动作 |
| `agent_end` | AI 主动结束时 | 提醒提交 git、更新记忆 |
| `message_end` | AI 每条回复完成后 | 检测回复中的问题模式 |
| `session_end` | 会话结束时 | 会话级收尾 |
| `session_shutdown` | 会话关闭时 | 清理资源 |

### 动作（Action）

规则匹配后可以执行 4 种动作：

| 动作 | 效果 |
|------|------|
| `block` | 阻止工具执行，返回原因 |
| `notify` | 弹出提醒，AI 可以选择忽略 |
| `steer` | 注入下一轮对话，强制 AI 响应 |
| `rewrite` | 改写工具参数后继续执行 |

### 条件匹配

**单条件模式**（简单场景）：
```json
{ "pattern": "\\bcat\\b", "flags": "" }
```

**多条件模式**（精确控制）：
```json
{
  "conditions": [
    { "field": "path", "pattern": "\\.ts$" },
    { "field": "text", "pattern": "\\n  [\\S ]" }
  ]
}
```

多个 `conditions` 默认是 **AND** 关系（全部满足才触发），可通过 `conditionLogic: "or"` 改为 OR。

**内置条件**（不需要正则）：

| builtin | 检查内容 |
|---------|---------|
| `git_dirty` | 有已跟踪文件的未提交改动 |
| `git_untracked` | 有未跟踪文件 |
| `has_edits` | 本轮调用过 edit/write |
| `always` | 始终匹配 |

### 有状态规则

通过 `state` 字段追踪工具调用统计，实现「N 次错误后提醒」等模式：

```json
{
  "comment": "连续出错后提醒翻记忆",
  "hook": "tool_result",
  "action": "steer",
  "state": { "countKind": "errors", "gte": 5 },
  "reason": "工具反复出错，请检查记忆文件是否有踩坑记录"
}
```

支持三种计数方式：
- `calls`：工具调用次数
- `errors`：连续错误次数
- `chars`：工具返回的字符量

配合 `resetOn` 可以在某个工具成功后重置计数（如测试通过后清零错误计数）。

## 规则格式

完整的规则字段：

```json
{
  "comment": "规则描述（必填，同时作为唯一标识）",
  "hook": "tool_call",
  "tool": "bash",
  "action": "block",
  "reason": "给 AI 看的提示信息",
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

**必填字段**：`comment`、`reason`

**可选字段说明**：
- `enabled`：`false` 禁用规则（默认 `true`，可省略）
- `subagent`：`false` 表示子代理中跳过此规则
- `requiresTools`：只有这些工具都可用时才触发
- `requireSuccess`：`true` 表示跳过 isError 的 tool_result
- `stopReason`：`agent_end` 专用，限制只在特定结束原因时触发

## 规则存放位置

**全局规则**：`~/.pi/agent/extensions/shepherd/rules.json`（所有项目生效）

**项目规则**：`{cwd}/.pi/extensions/shepherd-rules.json`（仅当前项目生效）
或 `{cwd}/.pi/extensions/shepherd-rules-*.json`（多文件）

项目规则和全局规则合并执行，项目规则可以补充或覆盖全局规则。

## 管理规则

使用 `shepherd_rules` 工具安全编辑规则（自动校验格式、备份、回滚）：

```
# 列出所有规则
shepherd_rules(action: "list")

# 添加规则
shepherd_rules(action: "add", rule: { comment: "...", hook: "...", ... })

# 更新规则
shepherd_rules(action: "update", index: 2, changes: { enabled: false })

# 删除规则
shepherd_rules(action: "delete", index: 3)
```

## 实战示例

### 1. 编辑 Python 后自动跑测试

```json
{
  "comment": "编辑 Python 后跑测试",
  "hook": "tool_result",
  "tool": "edit",
  "action": "notify",
  "conditions": [{ "field": "path", "pattern": "\\.py$" }],
  "reason": "编辑了 Python 文件，请运行 ruff check 和单元测试"
}
```

### 2. 会话结束前检查 git

```json
{
  "comment": "会话结束检查 git",
  "hook": "agent_end",
  "action": "notify",
  "conditions": [
    { "builtin": "git_dirty" },
    { "builtin": "git_untracked" }
  ],
  "conditionLogic": "or",
  "reason": "Git 有未提交改动，请确认是否需要 commit + push"
}
```

### 3. 拦截 grep 搜代码，推荐 code-graph

```json
{
  "comment": "推荐 code-graph 替代 grep",
  "hook": "tool_result",
  "tool": "grep",
  "action": "notify",
  "pattern": ".",
  "reason": "搜代码推荐用 code-graph：semantic_code_search（模糊）、get_ast_node（精确）、find_references（引用）",
  "requiresTools": ["code_graph_semantic_code_search"]
}
```

### 4. 拦截 AI 回复中的归因猜测

```json
{
  "comment": "禁止归因猜测",
  "hook": "message_end",
  "action": "steer",
  "pattern": "(可能是|猜测|大概|也许是).*(jiti|缓存|工具链)",
  "reason": "不要猜测根因——先查自己的代码逻辑，搜索最佳实践，验证后再下结论"
}
```

### 5. 禁止直接编辑 settings.json

```json
{
  "comment": "禁止直接编辑 settings.json",
  "hook": "tool_call",
  "tool": "edit|write",
  "action": "block",
  "conditions": [{ "field": "path", "pattern": "settings\\.json$" }],
  "reason": "直接编辑 settings.json 曾导致配置丢失，必须使用 settings_patch 工具"
}
```

## 架构

```
pi-shepherd/
├── index.ts              # 入口：注册所有钩子
├── shepherd/
│   ├── rules.ts          # 规则类型定义 + 加载/编译/匹配
│   ├── conditions.ts     # Condition 类型 + builtin 条件匹配
│   ├── state-tracker.ts  # 有状态规则的状态追踪器
│   ├── tool-hooks.ts     # tool_call / tool_result 钩子处理
│   ├── message-end.ts    # message_end 钩子处理
│   ├── rules-tool.ts     # shepherd_rules 工具注册
│   ├── rules-editor.ts   # 规则文件安全编辑（备份+校验）
│   ├── rules-validate.ts # 规则格式校验
│   ├── ephemeral.ts      # 提示缓冲区（pushWarning）
│   ├── git.ts            # git 状态检查工具函数
│   └── worktree-check.ts # worktree 环境检测
├── rules.json            # 默认全局规则
└── tests/                # 测试
```

**依赖**：
- `@pi-atelier/shared-utils` — 配置 API、工具输出格式化
- `@earendil-works/pi-coding-agent` — ExtensionAPI（peer）

## License

MIT
