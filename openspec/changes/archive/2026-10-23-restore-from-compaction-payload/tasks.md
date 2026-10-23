# Tasks: restore-from-compaction-payload

## 1. 激活源切换（净删实时记录层）

- [x] 1.1 `shepherd/context-restore.ts`：删除 `_activeDocs` Set、`recordContextRead`、`getActiveDocs`、`resetContextTracker` 与 `registerContextTracker` 的 `tool_execution_start` 挂载、existsSync 预检；保留 `isContextDocRead` 谓词与 `DEFAULT_CONTEXT_RESTORE`/`buildRestoreDecision`
- [x] 1.2 `shepherd/context-restore.ts`：新增纯函数 `filterContextDocs(readFiles: unknown): string[]`——数组校验 + 谓词过滤，作为 payload 清单的适配层
- [x] 1.3 `shepherd/compaction.ts`：session_compact handler 从 `event.compactionEntry?.details?.readFiles` 取清单 → `filterContextDocs` → 传入 `buildRestoreDecision`（替代 `getActiveDocs()`）
- [x] 1.4 `shepherd/index.ts` 与根 `index.ts`：删 `registerContextTracker` 挂载调用与 barrel 导出同步
- [x] 1.5 compaction-reminder 联动（恢复成功降级 notify、skipped 点名）行为保持不变（回归验证）

## 2. 空集观测

- [x] 2.1 handler 内：候选清单为空时记审计日志 empty 行，不调用 sendMessage（初版 ctx.ui.notify，演进为文件日志，见 4.3）
- [x] 2.2 区分三类输出：全量注入 ok 审计行 / 截断 skipped 点名 + 审计行 / 空集 empty 审计行

## 3. 测试改造

- [x] 3.1 `tests/context-restore.test.ts`：删实时记录/预检/Set 序用例；新增 `filterContextDocs` 单测（数组校验、谓词命中/不命中）与 payload 适配用例
- [x] 3.2 `tests/index-compaction.test.ts` 等集成用例：mock `session_compact` 事件改为携带 `compactionEntry.details.readFiles`，断言注入内容与最近优先序（数组尾优先）
- [x] 3.3 新增空集观测用例：readFiles 无命中 → debug notify、无 sendMessage；readFiles 非数组/缺失 → 同空集路径不崩溃
- [x] 3.4 7 个 index-*.test.ts 的 mock 清单同步（删 `registerContextTracker`）
- [x] 3.5 全量绿：`npm test`（625 上下浮动合理）+ `npm run typecheck` 0 错 + 源/测试行数 ≤200

## 4. 冒烟（真机，含 resume 回归）

- [x] 4.1 基线：read 一个 SKILL.md + 一个 openspec design.md → `/compact` → 恢复条目含两文档正文（沿用既有验收口径）
  - 实测：12 恢复 + 2 skip，readFiles 59 中谓词命中 14，对账闭合。design.md 本体未注入——其 read 落在保留区（宿主只统计挥发窗口），正文仍在上下文，无需恢复，属宿主正确语义而非缺陷；连续第二次压缩时继承链把挥发掉的注入正文再次带回，闭环自洽
- [x] 4.2 **resume 回归**：`/resume` 重启本会话（激活状态必然丢失）→ 不 read 直接 `/compact` → readFiles 继承/窗口语义生效，恢复仍注入（本次事故场景的直接回归）
  - 实测：用户关 pi → resume → /compact，注入照常（jsonl 1767→1768），零内存依赖，事故场景消灭
- [x] 4.3 空集观测：readFiles 无受保护文档时压缩 → 日志 empty 行、无注入、无 skipped
  - 实现演进：TUI ui.notify 实测不可见（info 级被降级为瞬态状态栏文本，warning 级同样不可见）→ 观测通道改为文件日志 ~/.pi/agent/logs/shepherd-restore.log（entry/empty/ok/skipped/fail 审计行）
  - 真机验证：manual + threshold 双路径，entry→empty 链条完整，零注入（2026-10-21 会话 ad41-a7ebc1345d84）
- [x] 4.4 清 jiti 缓存 → reload → 复跑 4.1
  - reload 后两次压缩（含 resume 后）全走 payload 新管线，等价覆盖

## 5. 文档与收尾

- [x] 5.1 README 功能段更新（激活源语义一句话）
- [x] 5.2 冒烟全过后精确提交（正常门禁）+ push
  - 00fb27d（main → main，pre-commit 门禁 624/624 + coverage 93% 通过）；rules.json/bak 非本变更改动未纳入
