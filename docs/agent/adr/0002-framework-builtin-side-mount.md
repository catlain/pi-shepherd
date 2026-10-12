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
