# compaction-reminder Delta Spec（MODIFIED）

## MODIFIED Requirements

### Requirement: 提醒注入语义

session_compact 的提醒 SHALL 复用现有 ephemeral 管线（pushWarning → drainHints → before_provider_request 注入即焚），SHALL NOT 写入 session 历史，SHALL NOT 调用 sendMessage(triggerTurn)——三种 reason 的压缩之后均必然存在下一个 provider request。与 context-restore 恢复注入联动：恢复注入成功（≥1 个上下文文档注入）时 SHALL 跳过"请重读"steer 文本、改写审计日志 ok 行；候选清单为空、恢复未启用或注入失败时 SHALL 维持原提醒；截断产生的未恢复名单 SHALL 追加进提醒文本点名。

变更点（相对 extend-context-restore 交付的口径）：降级观测通道从 ui.notify 轻提示改为审计日志（`~/.pi/agent/logs/shepherd-restore.log` 的 ok 行）——TUI showExtensionNotify 把 info 级降级为瞬态状态栏文本（压缩流程状态更新立刻淹没）、warning 级同样真机验收不可见，故 ui.notify 通道整体弃用。

#### Scenario: 恢复成功时提醒降级
- **WHEN** 压缩发生且 context-restore 成功注入 2 个上下文文档（1 技能 + 1 design.md）
- **THEN** 不注入"请重读"steer 文本，审计日志记 ok 行（restored=2），规则引擎匹配语义不变

#### Scenario: 截断名单点名
- **WHEN** 恢复注入因预算截断，2 个文档进入未恢复名单
- **THEN** 提醒文本追加点名这 2 个文档的路径，引导按需重读，审计日志记 skipped 行

#### Scenario: 空集时维持原提醒
- **WHEN** 压缩发生且谓词过滤后候选清单为空
- **THEN** 按纯提醒行为注入"请重读"提醒，审计日志记 empty 行
