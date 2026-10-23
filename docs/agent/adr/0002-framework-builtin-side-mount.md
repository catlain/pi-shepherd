---
id: ADR-0002
title: 框架内建行为以独立模块旁挂，不进规则引擎
status: active
subsystem: uncategorized
date: 2026-10-12
---

- **日期**: 2026-10-12
- **状态**: active
- **决策**: shepherd 中"框架内建、非用户策略"的功能（如 skill-restore 的记录→恢复）SHALL 以独立模块旁挂 index.ts 实现，SHALL NOT 塞进规则引擎 / rules.json / rules-validate。
- **原因**: 规则引擎面向用户可配置策略（提醒/拦截/重写），内建行为若走规则引擎会以"用户看到却删不掉的系统规则"形式污染规则列表；独立谓词旁挂还避免给规则引擎全量匹配增加负担。维护者裁定支持，且与既有先例一致（state-tracker、ephemeral hint 均为独立模块旁挂）。
- **替代方案（被否）**: ①作为内置规则进规则引擎——污染规则列表、语义错位（内建≠可配置）；②做成默认规则写 rules.json——用户可误删误改，恢复注入失效难排查。
- **影响**: 规则引擎、rules.json、rules-validate 零改动；skill-restore 以 `registerSkillTracker` 旁挂（`pi.on("tool_execution_start")`）+ `performSkillRestore` 联动 compaction.ts 实现。后续同类内建功能（如其他上下文保护）沿用此模式。
- **证据来源**: change add-skill-restore-injection / design.md D3

## 增补 2026-10-22：激活源改为宿主 payload，无自有状态

- **日期**: 2026-10-22
- **状态**: Accepted
- **决策**: context-restore 的激活源 SHALL 取宿主 `session_compact` 事件 payload 的 `compactionEntry.details.readFiles`（继承 ∪ 挥发窗口语义），SHALL NOT 自建进程内存态激活集（tool_execution_start Set 方案已废弃）。
- **原因**: 自建状态在 /resume 进程重启时丢失且不可恢复（2026-10 Quant 事故：重启后压缩静默零恢复）；宿主 jsonl 跨 resume 连续统计，readFiles 继承链天然覆盖跨进程场景，真机冒烟全过。旁挂模块因此进一步退化为无状态纯函数适配层。
- **替代方案（被否）**: ①继续 tool_execution_start Set + 落盘持久化——引入自有存储与同步问题，重而脆弱；②fork 宿主加激活字段——越界改宿主，成本高。
- **影响**: 删除 registerContextTracker 挂载与全部 Set 状态；spec 明文记录宿主语义依赖（继承∪挥发窗口）；冒烟含 resume 回归；上游若变更 readFiles 语义，按 spec 契约回归验证后跟随。
- **证据来源**: change restore-from-compaction-payload / design.md D5
