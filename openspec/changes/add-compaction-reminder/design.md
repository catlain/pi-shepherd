Affects-subsystem: uncategorized

## Context

pi 宿主（1.1.0）原生提供 `session_before_compact` / `session_compact` / `session_compact_failed` 三个扩展事件（`ExtensionAPI.on` 重载，0.78 起可用）。shepherd 目前注册 6 个事件（before_provider_request / session_start / agent_start / input / agent_end / session_shutdown + tool_call / tool_result / message_end 三个 hook 处理器），对压缩事件零覆盖。

压缩对 LLM 上下文的影响是结构性的：system prompt 里的技能索引（name/description/location 三元组）常驻不丢，但历史消息里被 read 的 SKILL.md 正文随摘要化挥发——AI "知道有哪些技能、不记得怎么用"。

shepherd 已有的注入管线：规则触发 → `pushWarning()` → shared-utils 缓冲区 → `before_provider_request` 的 `drainHints()` → 注入 user message + `ui.notify` → 即焚（不进 session 历史）。

前置依赖：fix-typecheck-governance（commit 61aedac）已清零 shepherd 40 个测试类型错并提供 `tests/helpers.ts` 的 `makeRule`/`makeCondition` mock 工厂；对方已在 Condition 类型补 "command"，明确不触碰 reason 相关改动，本 change 无合并冲突。

## Goals / Non-Goals

**Goals:**

- shepherd 能感知压缩事件并按用户规则注入"技能正文已挥发，需要请重读"类提醒
- 规则化：用户可在 rules.json 配置 `hook: "session_compact"` 规则（文案、启停、reason 过滤），`shepherd_rules` 工具全链路可用
- 零新增机制：完全复用现有 ephemeral 管线与条件匹配系统

**Non-Goals:**

- 技能清单记账（监听 tool_call read×SKILL.md 路径做点名重读）——StateTracker 记账 + resume 失忆问题，复杂度不配
- `session_compact_failed` 监听——失败=未压缩=正文还在，pi 自有失败 UI
- 压缩摘要定制（改 customInstructions / 接管压缩流程）——属 pi-smart-compact 的领地
- C 档方案（system prompt 常驻元指令）——独立于本 change，不绑定

## Decisions

### D1 注入时机：不 sendMessage(triggerTurn)

`session_compact` 触发时无进行中的请求，handler 只 `pushWarning`，由下一个 `before_provider_request` 的 drainHints 消费。依据：三种 reason 的压缩后均必然存在下一个 provider request（overflow→willRetry 自动重试；manual/threshold→用户下一条消息输入）。备选（agent_end 式 sendMessage triggerTurn）被否：会制造多余的一轮对话，且 overflow 重试场景下注入时序反而错位。

- **Type**: one-off
- **Sediment-to**: none

### D2 触发语义：事件天然去重，不用 _fired Set

不引入 message_end 式的 `_messageEndFired` 防重复集合（那是"每轮至多一次"语义）。一次压缩 = 一次真实挥发 = 一次提醒；同一会话多次压缩（threshold 反复触发）应各提醒一次。module 级 Set 反而会吞掉第二次以后的提醒。

- **Type**: one-off
- **Sediment-to**: none

### D3 reason 过滤：复用 conditions 机制，field 扩展 "reason"

按需过滤（如只提醒静默的 threshold/overflow）通过 `conditions: [{field: "reason", pattern: "threshold|overflow"}]` 表达，正则匹配 `event.reason`（manual/threshold/overflow）。备选（专用 `reasonFilter` 数组字段）被否：新 schema 字段 vs 现有条件系统的一处 field 扩展，后者与既有风格零冲突。改动三处：`Condition.field` 联合类型、`rules-validate.ts` validFields、`matchBuiltinCondition`。

- **Type**: one-off
- **Sediment-to**: none

### D4 文案归属：规则驱动，代码零默认文案

提示文本是用户职权，由 rules.json 声明。change 实施时附带一条默认规则 `compact-skill-reminder` 写入全局 rules.json（引导性措辞："若当前任务涉及某技能，请重新 read 其 SKILL.md"——非命令性，避免 overflow 重试时打断深度任务）。

- **Type**: one-off
- **Sediment-to**: none

### D5 范围裁剪：A1 清单与 failed 监听均不做

A1（点名重读）需要 tool_call 监听 + StateTracker 记账 + 清单持久化（解决 resume 失忆），投入产出不成立；system prompt 技能索引常驻 + 引导性文案已覆盖"AI 自行判断哪个技能相关"的 90% 场景。failed 事件时上下文未变，无提醒价值。

- **Type**: one-off
- **Sediment-to**: none

### D6 handler 结构：照 message-end.ts 模板

新文件 `shepherd/compaction.ts` 导出 `registerSessionCompact(pi, state, rulesDir, rulesOptions)`，内部：过滤 `hook === "session_compact"` 规则 → enabled/isSubagent/toolsAvailable 检查 → conditions 匹配（手工构造 targets，reason 填入）→ pushWarning。手工构造的 targets 形如 `{ text: "", path: "", command: "", glob: "", reason }`（reason 作为新 key 供条件匹配）。

- **Type**: one-off
- **Sediment-to**: none

### D7 测试策略：mock 捕获 handler + 手动触发 event

用 `vi.fn()` 捕获 `pi.on("session_compact", handler)` 的 handler，手动调用合成 event（三种 reason × 有/无规则 × conditions 过滤 × 子代理环境）断言 `hasHints()`/`drainHints()` 行为。规则对象一律走 `tests/helpers.ts` 的 `makeRule`（真实类型，避免 P2 清理过的 any 掩盖债复发）。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [宿主行为契约依赖] D1 依赖"压缩后必有下一个 provider request"——若宿主未来改变 overflow 重试策略（如放弃重试），overflow 场景提醒可能悬挂至用户下次输入。→ 缓解：悬挂的 hint 无害（缓冲区即焚特性），最坏延迟到下一条消息。
- [willRetry 注入干扰] overflow 重试请求中注入提醒，可能让 AI 在深度任务中途分心响应提示。→ 缓解：默认规则用引导性措辞（"若当前任务涉及某技能"），spec D4 已约束；用户可 reason 过滤掉 overflow。
- [与 pi-smart-compact 的边界] smart-compact 接管压缩流程后，session_compact 事件仍由宿主发出（事件在 AgentSession 层），两者无顺序耦合；但若未来 smart-compact 也在压缩摘要里保留技能信息，提醒可能冗余。→ 缓解：默认规则 enabled 可关；文案与摘要信息不冲突（一个是"正文挥发提醒"，一个是"摘要内容"）。
- [validFields 与 Condition 类型的同步漂移] 本 change 需同时改三处（类型/校验/匹配），历史上曾因只改一处产生 command 分叉（P2 已修）。→ 缓解：tasks 中将三处列为同一任务项，测试覆盖 field: "reason" 的校验路径。
