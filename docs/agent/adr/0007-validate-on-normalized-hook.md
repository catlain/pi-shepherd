---
id: ADR-0007
title: 组合校验挂在归一化后的 hook 上，校验模型与运行时归一化同构
status: active
subsystem: uncategorized
date: 2026-11-05
---

- **日期**: 2026-11-05
- **状态**: Accepted
- **决策**: 校验器对 hook 的组合校验使用 `normalizeHook(rule)`（缺省 = tool_call）归一化后的值；action 同样按运行时默认（缺省 = block）归一化后校验。
- **原因**: 存量 40 条规则中 9 条无 hook 字段，运行时全部按 tool_call 处理；若校验按原始字段跳过，`{action:"steer"}` 无 hook 的新规则会绕过组合校验后静默失效。校验必须基于运行时行为模型而非配置原始形状，否则校验器放行的规则与运行时消费的规则是两套语义。
- **替代方案（被否）**: 按原始字段校验（无 hook 即跳过组合检查）——静默失效通道对无 hook 规则敞开，恰是存量 30/34 的实际形态。
- **影响**: validateRule 与 updateRule 分层校验共用 `validateHookActionCombo`（导出函数）；「无 action 的 message_end/agent_end/session_shutdown 规则」从此被正确拒绝（运行时默认 block 无人消费——本次测试修正的 3 处旧用例即此形态）。
- **证据来源**: change hook-action-validation / design.md D2
