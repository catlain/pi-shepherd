# Proposal: audit-fixes-single-source

## Why

unify-protected-doc-list 归档后，双审计门禁（对抗审计 + smell 扫描）的追加修复以三批跨包发版落地（1.2.1 / 1.3.0 / 0.2.0 / 0.3.3），其中两个决策点散落在 commit message 里，需要工件化沉淀：① payload/core.ts 保留 `max(1,…)` 面板占位适配层（业务语义显式化，与裸估算口径的分层）；② `estimateTokens` 上收 shared-utils 单源（ADR-0004 单源原则延伸到公用工具函数）。

## What Changes

- **W1（已实施）**：ephemeral 空 label 归一化（`''` 等价 `undefined`）上收 shared-utils `pushHint` 源头（v1.2.1），pi-shepherd 拆除本地包装层恢复直通 re-export
- **S3（已实施）**：删除 pi-context-manager 的 `isSkillFilePath` / `isOpenspecDesignPath` 历史别名 re-export，全部测试统一 import 原名 `isSkillMdPath` / `isOpenspecDesignDocPath`（v0.2.0，删导出故 minor）
- **S5（已实施）**：token 估算四名归一（`estimateTokens` / `est` / `estTokens` / `estimateDocTokens`）——`estimateTokens` 上收 shared-utils（v1.3.0）单一源头，context-manager / shepherd 全部改 import；payload/core.ts 保留 `max(1, base)` 显式业务适配层（每消息至少 1 token 的面板占位语义，注释声明，非重复实现）

## Impact

- 全部代码已实施、测试全绿（309 / 823 / 657）、已发版推送——本 change 为**补记性质**，无新代码变更
- ADR-0004 补记适用范围（estimateTokens、label 归一化纳入"跨包共享逻辑单源化"原则）
- 无 spec 变更：protected-doc-list / context-restore 能力行为不变（W1/S3 是内部实现收敛；S5 的 estimateTokens 属工具函数，非 capability 行为）
