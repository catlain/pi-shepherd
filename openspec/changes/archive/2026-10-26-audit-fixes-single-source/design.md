# Design: audit-fixes-single-source

Affects-subsystem: uncategorized

## Context

unify-protected-doc-list 归档审计暴露三项残留（W1 归一化层级、S3 别名双轨、S5 token 估算四名分叉），用户裁决"技术债坚决消灭、该统一彻底统一"，三批修复已跨包发版落地。本 change 补记决策，防止只活在 commit message 里。

## Goals / Non-Goals

**Goals:**

- 补记三个已实施决策，ADR-0004 适用范围延伸到公用工具函数单源化

**Non-Goals:**

- 不做任何新代码变更（全部已实施发版）
- 不处理 collect.ts（387 行）/ distill-helpers.ts（258 行）的文件拆分（独立重构议题，shepherd 阈值提醒挂账）

## Decisions

### D1 estimateTokens 上收 shared-utils，payload 侧保留显式业务适配层

token 估算原为四名四处实现（distill-helpers `estimateTokens`、collect.ts `est`、payload/core.ts `estTokens`（含 `max(1,…)` 下限）、shepherd `estimateDocTokens`），SHALL 统一为 shared-utils `estimateTokens`（`ceil(len/4)`，v1.3.0）单一源头。payload/core.ts 保留 `max(1, baseEstimateTokens)` 包装——这是**业务规则显式化**（面板统计每消息至少 1 token 占位，裸合并会使空消息统计归零），注释声明语义，不算第二种口径。

- **Type**: layering-principle
- **Sediment-to**: ADR

### D2 别名与包装层全部拆除，同名转发门面是唯一允许的兼容形态

S3 删除 `isSkillFilePath` / `isOpenspecDesignPath` 历史别名（两名并存=债）；W1 拆除 shepherd 本地归一化包装（契约靠每个消费方自觉=分叉根源，归一化上收源头）。允许保留的形态仅限**同名单点转发门面**（如 distill-helpers 的 `export { estimateTokens }`、payload/core.ts 的同名包装）——同名不产生第二名字，转发不产生第二实现，消费方 import 路径稳定。

- **Type**: layering-principle
- **Sediment-to**: ADR

## Risks / Trade-offs

- [payload max(1) 适配层可能被后续维护者误删] → 注释显式声明语义 + 本 ADR 补记决策依据
- [删别名是 breaking（0.2.0 minor）] → 生态内消费方仅各包测试，无外部 import（已 grep 验证）

## Migration Plan

已全部实施（三包发版推送）。本 change 仅补记，归档即终点。回滚 = revert 各包提交。

## Open Questions

（无）
