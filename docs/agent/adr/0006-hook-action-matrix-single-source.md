---
id: ADR-0006
title: hook×action 支持矩阵以导出常量为单一来源，校验清单从矩阵派生
status: active
subsystem: uncategorized
date: 2026-11-05
---

- **日期**: 2026-11-05
- **状态**: Accepted
- **决策**: hook×action 支持矩阵作为 `HOOK_ACTION_SUPPORT` 导出常量放 rules-types.ts；校验器的 `VALID_ACTIONS`/`VALID_HOOKS` 合法值清单从该矩阵派生，不手写第二份。
- **原因**: 2026-11 规则 39 事故（tool_call+steer 添加校验通过、运行时静默失效）的直接根因是「组合有效性无人负责」——校验器分别校验 action/hook 各自合法值，两者独立通过即放行。更深根因与 ADR-0001 同族：校验矩阵与运行时消费分支是同一事实的两份描述，人工维护必然漂移（本次是「描述缺失」型漂移，另发现存量 30/34 两条早已静默失效）。矩阵每键注释消费分支源码位置，运行时分支增删 MUST 同步矩阵。
- **替代方案（被否）**: ①只在 rules-validate.ts 校验器内维护组合表——校验器与运行时两份描述，重演双清单漂移；②让 tool_call 支持 steer（行为扩展）——治标不治本，静默失效通道仍在；③运行时对无效组合抛错拒绝加载——一条坏规则拖垮整个 shepherd，改为警告（ADR 关联：运行时警告 requirement）。
- **影响**: rules-validate.ts 的两个合法值常量改为派生；新增 hook/扩展 action 时更新矩阵即可全链路联动（类型除外，Rule 接口的 action/hook 字面量联合仍手写——已知边界，见 INV 检查方式）；矩阵未收录的 hook 被校验器拒绝并提示先更新矩阵（开发期错误优先暴露）。
- **证据来源**: change hook-action-validation / design.md D1
- **关联不变量**: 与 ADR-0001 同族原则的维度扩展（矩阵同步义务的检查方式：矩阵键注释源码行号核对 + rules-hook-action-combo.test.ts 矩阵完整性用例）
