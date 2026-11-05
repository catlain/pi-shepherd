---
id: ADR-0008
title: update 分层校验扩展到组合维度——触及才严、未触及降级
status: active
subsystem: uncategorized
date: 2026-11-05
---

- **日期**: 2026-11-05
- **状态**: Accepted
- **决策**: updateRule 对 hook×action 组合维度复用分层原则：changes 触及 hook/action 字段时，合并后组合无效即拒绝；未触及组合维度的 update 对存量无效组合降级为警告放行。
- **原因**: 存量 2 条无效组合规则（30/34）若被 merged 校验连坐拒绝，则重演 8-31「存量规则永久锁死」事故（无法 update 任何字段，连 enabled:false 都做不到）。分层使存量可被逐步修复（先关后修），新劣化在触及组合的写入路径被拦。
- **替代方案（被否）**: merged 校验一律严格——连坐锁死存量；merged 校验一律警告——新劣化（把合法规则 update 成无效组合）无拦截。
- **影响**: rules-editor.ts updateRule 增加 comboErrors 分层分支（警告去重拼接）；与既有「update 分层校验」requirement 同构，是其维度扩展。
- **证据来源**: change hook-action-validation / design.md D3；复用 10-12 D2 原则（ADR-0001 族）
