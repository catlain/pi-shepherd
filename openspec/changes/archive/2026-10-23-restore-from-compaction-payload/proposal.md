# Proposal: restore-from-compaction-payload

## Why

- **真实事故**（2026-10-21，Quant 会话 `01a0c207`）：长会话 `/resume` 重启后，模块级激活集 `_activeDocs` 清零，且新进程内未 read 过受保护文档 → 14:59 自动压缩时恢复管线静默无注入（restored=0 且 skipped=0，用户无从区分"没恢复"与"没得恢复"）。历史 read 过的技能正文全部挥发丢失。
- 现有方案（`tool_execution_start` 实时记录进模块级 Set）的根本缺陷：**自有进程态与宿主真源（jsonl）双轨**——resume / reload / fork 任何进程边界都会丢状态，同类事故必然复发。
- 宿主事实（agent-session.js L2233-2247 + compaction.js L16-36）：`session_compact` 事件 payload 的 `compactionEntry.details.readFiles` 是宿主维护的 read 文件清单，语义 = **上次压缩 readFiles 继承 ∪ 本次挥发窗口（messagesToSummarize）内的全部 read 调用**——跨压缩接力宿主已做，跨进程（jsonl 续写）天然覆盖。

## What Changes

- **删除自建激活记录层**：`tool_execution_start` 事件挂载、模块级 `_activeDocs` Set、`recordContextRead`、existsSync 预检及相关测试。
- **恢复管线改为无状态纯事件驱动**：`session_compact` handler 直接从 `event.compactionEntry.details.readFiles` 取清单 → `isContextDocRead` 谓词过滤（SKILL.md ∪ openspec/**/*.md）→ `buildRestoreDecision`（maxTokens 预算、最近优先、skipped 点名——不变）。
- **空集可观测**：readFiles 无谓词命中时记审计日志 empty 行，区分"没有可恢复对象"与"恢复失败"（初版为 debug 级 notify，4.3 真机验收发现 TUI ui.notify 不可见，演进为文件日志，见 tasks 4.3 注记）。
- 配置（`shepherd.contextRestore` / `/compact-config`）、注入 customType、compaction-reminder 联动均不变。

## Impact

- **代码**（pi-shepherd）：`shepherd/context-restore.ts`（净删实时记录层，改由 compaction.ts 传 readFiles）、`shepherd/compaction.ts`（handler 取 payload）、`shepherd/index.ts`（删事件挂载）、`index.ts`（同步）；测试同步改造。
- **specs**：主 spec `context-restore` 的"激活记录"Requirement 改写为"激活源=事件 payload"；新增空集观测场景。
- **风险**：宿主语义耦合（上游若改 readFiles 定义则被动跟随）——群岛生态可控；保留区重复注入边缘 case（继承链带入正文仍在保留区的文件）——maxTokens 预算兜底，与旧方案等价。
