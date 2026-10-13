# compaction-reminder Delta Spec（MODIFIED）

## MODIFIED Requirements

### Requirement: 提醒注入语义

session_compact 的提醒 SHALL 复用现有 ephemeral 管线（pushWarning → drainHints → before_provider_request 注入即焚），SHALL NOT 写入 session 历史，SHALL NOT 调用 sendMessage(triggerTurn)。与 context-restore 恢复注入联动：恢复注入成功（≥1 个上下文文档注入）时 SHALL 跳过"请重读"steer 文本、改发 ui.notify 轻提示；激活集为空、恢复未启用或注入失败时 SHALL 维持原提醒；截断产生的未恢复名单 SHALL 追加进提醒文本点名。文案措辞从"技能正文"泛化为"上下文文档正文"。

#### Scenario: 提醒不污染历史
- **WHEN** 压缩提醒被注入并被 AI 消费
- **THEN** 提醒文本不持久化到 session 历史，后续请求不再重复出现

#### Scenario: 多次压缩多次提醒
- **WHEN** 同一会话内发生两次压缩
- **THEN** 每次压缩各触发一次提醒，不做每会话一次的去重

#### Scenario: 恢复成功时提醒降级
- **WHEN** 压缩发生且 context-restore 成功注入 2 个上下文文档（1 技能 + 1 design.md）
- **THEN** 不注入"请重读"steer 文本，仅 ui.notify 轻提示"已恢复上下文文档: …"，规则引擎匹配语义不变

#### Scenario: 恢复关闭或空集时维持原提醒
- **WHEN** 压缩发生且 contextRestore.enabled=false 或激活集为空
- **THEN** 按纯提醒行为注入"请按需重读"提醒

#### Scenario: 截断名单点名
- **WHEN** 恢复注入因预算截断，2 个文档进入未恢复名单
- **THEN** 提醒文本追加点名这 2 个文档的路径，引导按需重读
