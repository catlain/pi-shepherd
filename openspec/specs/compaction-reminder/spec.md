# compaction-reminder Specification

## Purpose

会话压缩（compaction）会把消息历史摘要化，此前 read 进上下文的 SKILL.md 技能正文随之挥发，而 system prompt 里的技能索引（名字/描述/路径）仍在——AI 常常“记得技能存在”却拿不到操作指引。本 capability 让 shepherd 在压缩事件后注入一条提醒，引导 AI 按需重读相关 SKILL.md。注入走 ephemeral 即焚管线（不留会话历史），由压缩后必然存在的下一个 provider request 消费。

## Requirements

### Requirement: session_compact 事件监听

shepherd SHALL 监听 pi 扩展 API 的 `session_compact` 事件，在压缩成功后按 `hook: "session_compact"` 的规则触发提醒。

#### Scenario: 手动压缩触发提醒
- **WHEN** 用户执行 `/compact`（reason=manual）且存在启用的 `session_compact` 规则
- **THEN** 规则触发，提醒文本进入 ephemeral 缓冲区，在用户下一条消息的 provider request 中注入

#### Scenario: 溢出压缩注入重试请求
- **WHEN** overflow 压缩发生且 `willRetry=true`
- **THEN** 提醒在自动重试的 provider request 中注入，不额外发送 sendMessage(triggerTurn)

#### Scenario: 无规则时零开销
- **WHEN** rules.json 中不存在 `session_compact` 规则（或全部 disabled）
- **THEN** 事件监听为空转，不产生任何注入或通知

### Requirement: reason 条件过滤

规则 SHALL 支持通过 conditions 的 `field: "reason"` + 正则 pattern 匹配压缩触发源（`manual` / `threshold` / `overflow`），实现按需过滤提醒范围。

#### Scenario: 仅提醒静默压缩
- **WHEN** 规则声明 `"conditions": [{"field": "reason", "pattern": "threshold|overflow"}]` 且发生 reason=manual 的压缩
- **THEN** 规则不触发

#### Scenario: 无条件全量提醒
- **WHEN** 规则未声明 conditions（或为空数组）且发生任意 reason 的压缩
- **THEN** 规则触发

### Requirement: 提醒注入语义

session_compact 的提醒 SHALL 复用现有 ephemeral 管线（pushWarning → drainHints → before_provider_request 注入即焚），SHALL NOT 写入 session 历史，SHALL NOT 调用 sendMessage(triggerTurn)——三种 reason 的压缩之后均必然存在下一个 provider request。与 skill-restore 恢复注入联动：恢复注入成功（≥1 技能正文注入）时 SHALL 跳过"请重读"steer 文本、改发 ui.notify 轻提示；激活集为空、恢复未启用或注入失败时 SHALL 维持原提醒；截断产生的未恢复名单 SHALL 追加进提醒文本点名。

#### Scenario: 提醒不污染历史
- **WHEN** 压缩提醒被注入并被 AI 消费
- **THEN** 提醒文本不持久化到 session 历史，后续请求不再重复出现

#### Scenario: 多次压缩多次提醒
- **WHEN** 同一会话内发生两次压缩（如 threshold 两次触发）
- **THEN** 每次压缩各触发一次提醒，不做每会话一次的去重

#### Scenario: 恢复成功时提醒降级
- **WHEN** 压缩发生且 skill-restore 成功注入 2 个技能正文
- **THEN** 不注入"请重读"steer 文本，仅 ui.notify 轻提示"已恢复技能: …"，规则引擎匹配语义不变

#### Scenario: 恢复关闭或空集时维持原提醒
- **WHEN** 压缩发生且 skillRestore.enabled=false 或激活集为空
- **THEN** 按 0.2.0 原行为注入"请重读"提醒

#### Scenario: 截断名单点名
- **WHEN** 恢复注入因上限截断，2 个技能进入未恢复名单
- **THEN** 提醒文本追加点名这 2 个技能的路径，引导按需重读

### Requirement: 规则校验扩展

`rules-validate.ts` 的 VALID_HOOKS SHALL 追加 `"session_compact"`，conditions 的 validFields SHALL 追加 `"reason"`；`shepherd_rules` 工具的 add/update 操作 SHALL 能安全写入 `session_compact` 规则。

#### Scenario: 合法规则通过校验
- **WHEN** 通过 shepherd_rules 工具添加含 `hook: "session_compact"`、`field: "reason"` 的规则
- **THEN** 校验通过并写入 rules.json

### Requirement: 子代理遵循现有语义

session_compact 规则 SHALL 遵循现有 `isSubagent()` + `rule.subagent` 字段语义：子代理环境下默认跳过，除非规则显式声明 `subagent: true`。

#### Scenario: 子代理压缩默认不提醒
- **WHEN** 子代理（isSubagent()=true）发生 overflow 压缩且规则未声明 subagent 字段
- **THEN** 规则不触发
