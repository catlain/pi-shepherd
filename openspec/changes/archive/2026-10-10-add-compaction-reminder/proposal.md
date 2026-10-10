# add-compaction-reminder

## Why

pi 会话压缩（manual /compact、threshold 阈值、overflow 溢出恢复）后，历史消息里被 read 过的 SKILL.md 技能正文随摘要化挥发，AI 失去操作指引而不自知，且 system prompt 里的技能索引（名字/描述/路径）仍在，形成"知道自己有哪些技能、却不记得怎么用"的隐性退化。pi SDK 原生提供 `session_compact` 事件（0.78+，宿主 1.1.0 已验证），shepherd 作为规则驱动提醒引擎，应把"压缩后提示重读"纳入其能力面。

## What Changes

- 新增 `session_compact` 事件监听：新文件 `shepherd/compaction.ts`（handler 模式照 `message-end.ts`），在 `index.ts` 注册
- 规则系统扩展：`Rule.hook` 联合类型追加 `"session_compact"`；conditions 新增 field `"reason"`（正则匹配 `manual|threshold|overflow`）
- 提醒走现有 ephemeral 管线（pushWarning → drainHints → before_provider_request 注入即焚），**无需** sendMessage(triggerTurn)——三种 reason 压缩后都必有下一个 provider request（overflow→自动重试；manual/threshold→用户下一条消息）
- `rules-validate.ts` 的 validFields 追加 `"reason"`（syncValue 与 Condition 类型同步）
- 附带一条默认规则 `compact-skill-reminder` 写入全局 rules.json（引导性措辞，非命令性）

## Capabilities

### New Capabilities

- `compaction-reminder`: 压缩事件感知与提醒注入——监听 pi 的 session_compact 事件，按用户规则在压缩后向下一轮对话注入"技能正文已挥发，需要请重读"类提示

### Modified Capabilities

（无——openspec/specs/ 当前为空，无存量 capability 需求变更）

## Impact

- **代码**：`pi-shepherd` 6 处——新文件 `shepherd/compaction.ts`，修改 `shepherd/rules.ts`（Rule.hook + Condition.field "reason"）、`shepherd/rules-validate.ts`（VALID_HOOKS + validFields）、`shepherd/conditions.ts`（matchBuiltinCondition 支持 reason）、`shepherd/index.ts`（barrel export）、`index.ts`（注册）
- **配置**：全局 `~/.pi/agent/extensions/shepherd/rules.json` 追加默认规则
- **依赖**：基于 fix-typecheck-governance（61aedac）干净基线开发；对方已在 Condition 类型上补 "command"、未触碰 reason 相关三处，无合并冲突
- **不做（Out of scope）**：技能清单记账（监听 tool_call read×SKILL.md 记路径）——StateTracker 记账 + resume 失忆问题，复杂度不配，留作后续增强；`session_compact_failed` 监听（失败=没压缩=正文还在）
