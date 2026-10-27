---
id: ADR-0005
title: 公用工具函数单源化——上收 shared-utils、同名转发门面为唯一兼容形态、业务适配层显式声明
status: active
subsystem: uncategorized
date: 2026-10-26
---

- **日期**: 2026-10-26
- **状态**: Accepted
- **决策**: 跨包复用的工具函数（token 估算、归一化等）SHALL 上收 `@pi-atelier/shared-utils` 单一实现；下游兼容形态仅允许**同名单点转发门面**（`export { fn } from "@pi-atelier/shared-utils"` 或同名 import 转发），SHALL NOT 保留异名别名（两名并存=债）或本地包装（契约靠消费方自觉=分叉根源）；确有业务语义差异的，SHALL 在消费方保留显式适配层并以注释声明语义（非第二种口径）。
- **原因**: unify-protected-doc-list 归档审计发现 token 估算四名四处实现（`estimateTokens`/`est`/`estTokens`/`estimateDocTokens`）、ephemeral 空 label 归一化靠 shepherd 单点包装、谓词历史别名两名并存——三种形态的"重复"实质不同：纯重复（必须上收）、异名兼容（必须删）、业务差异（必须显式化）。payload/core.ts 的 `max(1, …)` 下限是面板占位语义（空消息计 1 token），与裸 `ceil(len/4)` 合并会让统计归零——分层为"基础公式单源 + 业务适配显式"。
- **替代方案（被否）**: ① 四处实现各自保留（名义 Rule of Three，实为口径漂移温床）——用户裁决"技术债坚决消灭"，被否。② 统一为带下限的单函数——改变 distill 侧空文本 0 token 语义，用一种行为变化换名义统一，被否。③ 别名保留护住测试 import——两名并存是双轨制，测试改 import 成本一次性，被否。
- **影响**: shared-utils v1.3.0 新增 `tokens.ts`（estimateTokens）；context-manager v0.2.0 删别名导出 + collect.ts/payload/core.ts 收敛；shepherd v0.3.2/0.3.3 拆包装层、删 estimateDocTokens。后续跨包复用工具一律先看 shared-utils 可否上收；转发的门面模块（distill-helpers、payload/core）是包结构层，不算二道贩子。
- **证据来源**: change audit-fixes-single-source / design.md 决策 D1、D2；上游变更 unify-protected-doc-list（ADR-0004 姊妹篇：0004 管"领域清单逻辑"，本条管"公用工具函数"）
- **关联不变量**: ADR-0004
