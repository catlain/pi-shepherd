# Design: restore-from-compaction-payload

Affects-subsystem: uncategorized

## Context

extend-context-restore（e8b0702，2026-10-13）交付的恢复管线依赖两层：`tool_execution_start` 实时把受保护 read 记入模块级 `_activeDocs` Set；`session_compact` 时从 Set 取清单做预算决策注入。管线在单进程内工作正常（10-17 Quant 会话恢复成功实证），但 10-21 同一会话 `/resume` 重启后激活集清零 → 14:59 压缩静默无恢复（restored=0 且 skipped=0）。根因：自有进程态与宿主真源双轨，进程边界必丢。

宿主侧调查（pi 1.1.0 源码实证）：

- `agent-session.js` L2233-2247：压缩流程先 `appendCompaction()` 写 jsonl，再 emit `session_compact`，payload 携带完整 `compactionEntry`（含 `details.readFiles`）。
- `compaction.js` L16-36 `extractFileOperations`：readFiles = **上次压缩 readFiles 继承**（`prevCompactionIndex >= 0` 时逐条 add）∪ **本次挥发窗口（messagesToSummarize）内全部 read 工具调用**。
- jsonl 为续写单文件（跨 resume 边界），故 readFiles 统计天然跨进程。

## Goals & Non-Goals

**Goals**：

- resume / reload / fork 后压缩恢复照常工作（无自有状态）
- "没恢复"与"没得恢复"可区分（空集观测）
- 净删代码：删除实时记录层（事件挂载、Set、预检）

**Non-Goals**：

- 预算决策逻辑变更（maxTokens、最近优先、skipped 点名照旧）
- 配置面变更（`shepherd.contextRestore` / `/compact-config` 不动）
- 恢复非 read 来源的上下文（如注入消息的二次接力——readFiles 继承链已隐式覆盖）

## Decisions

### D1 激活源切换：模块级 Set → `compactionEntry.details.readFiles`

`session_compact` handler 从事件 payload 取 `compactionEntry.details.readFiles`（字符串数组），经 `isContextDocPath` 谓词过滤（实现重命名，设计初期写作 isContextDocRead）后作为恢复候选清单传入 `buildRestoreDecision`。理由：readFiles 语义（挥发窗口 read ∪ 上次继承）与"需要恢复的对象"精准对齐——正文仍在保留区的 read 不会进本次窗口统计（宿主只扫 messagesToSummarize），且跨压缩/跨进程连续性由宿主维护，零自建状态。

- **Type**: one-off
- **Sediment-to**: none

### D2 删除实时记录层（无替代品）

删除 `tool_execution_start` 挂载、`_activeDocs` Set、`recordContextRead`、`getActiveDocs`、`resetContextTracker` 及 existsSync 预检。理由：readFiles 是超集（含本进程全部 read），实时记录唯一消费者（压缩恢复）已由 D1 覆盖；existsSync 预检冗余（宿主 fileOps 只统计真实执行的 read 调用；文件事后被删由决策读盘 try-catch 兜底进 skipped）。`registerContextTracker` 若无其他消费者则一并删除并同步 barrel/index/测试 mock。

- **Type**: one-off
- **Sediment-to**: none

### D3 readFiles 序语义：数组序即激活序，最近优先取尾

readFiles 继承段在前、本次窗口 read 按消息序追加（宿主实现）。决策沿用"最近激活优先"：**数组尾部为最近**（本次窗口最后 read 的文件），倒序遍历注入。与旧 Set 插入序（重读移尾）语义对齐；预算截断时最旧的先被放弃。

- **Type**: one-off
- **Sediment-to**: none

### D4 空集观测：审计日志区分两类静默

谓词过滤后为空（readFiles 无受保护文档）时记 empty 审计行；有命中但全被预算截断走既有 skipped 点名。修复事故中"restored=0 且 skipped=0 无任何输出"的观测盲区。

实现演进：初版用 ui.notify（info → warning 升级），真机验收均不可见——TUI showExtensionNotify 把 info 降级为瞬态状态栏文本（压缩流程状态更新立刻淹没）、warning 级同样验收不可见 → 改为文件日志 `~/.pi/agent/logs/shepherd-restore.log`（entry/empty/ok/skipped/fail 五种审计行，带会话短 ID）。entry 入口行区分「事件未到达 handler」与「分支提前返回」，排障实测价值已验证。

- **Type**: one-off
- **Sediment-to**: none（host 层 ui.notify 可见性经验沉淀入 D4 本条）

### D5 宿主语义耦合的接受与防御

管线依赖 readFiles 的"继承 ∪ 挥发窗口"语义——上游演进（如改为仅摘要提及）会使恢复范围缩水。防御：spec 明文记录语义依赖；冒烟含 resume 场景回归；若上游变更，本能力按 spec 契约回归验证后跟随。接受理由：群岛生态宿主同源维护，且自建状态方案已被实证更脆弱（本次事故）。

- **Type**: layering-principle
- **Sediment-to**: ADR-0002

## Risks / Trade-offs

- **保留区重复注入**：继承链可带入正文仍在保留区的文件（上次 readFiles 中的旧文件），注入后上下文短时双份——maxTokens 预算与旧方案等价兜底，接受
- **fromHook 压缩无继承**：宿主仅对 pi 生成的压缩继承 readFiles（fromHook 条件）——shepherd 不触发压缩（无 fromHook 路径），不受影响
- **数组序假设**：readFiles 的"尾部=最近"依赖宿主实现顺序（继承在前、消息序在后）——冒烟验证注入顺序，若上游无序化则需按 jsonl 时间重排（留待实证）

## Migration Plan

1. 删除实时记录层 + handler 切 payload（单 PR 原子完成，测试同步）
2. 主 spec `context-restore` 激活源 Requirement 改写（归档时同步）
3. 无配置迁移：`shepherd.contextRestore` 结构不变
