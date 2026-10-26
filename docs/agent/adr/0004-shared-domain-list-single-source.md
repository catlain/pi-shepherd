---
id: ADR-0004
title: 跨包共享的领域清单逻辑沉淀 shared-utils 单一事实源，下游引用而非复制
status: active
subsystem: uncategorized
date: 2026-10-26
---

- **日期**: 2026-10-26
- **状态**: Accepted
- **决策**: 当同一领域语义被两个及以上 pi-* 包消费时（如"保护文档"清单同时被 pi-context-manager 的 aging 豁免与 pi-shepherd 的 compact 回补消费），清单/谓词逻辑 SHALL 只在 `@pi-atelier/shared-utils` 存在一份实现；下游包 SHALL import 引用，SHALL NOT 复制正则或平行实现。纯字符串零依赖的谓词可进 shared-utils 主 barrel；带重依赖（pi SDK 等）的模块走子路径导出（既有 barrel 规范）。
- **原因**: 保护文档清单在两包各自硬编码后立即出现第二次调整需求（aging 调音后回补侧分叉），复制方案的漂移成本已被实证——同语义两份清单，一包调音另一包不跟，行为互相矛盾（aging 淘汰 openspec 全量、回补却全量注入）。aging 保活 + compact 回补本是同一"宪法文档生命周期"的两端，语义必须由单一事实源承载。下游本地历史导出名可保留 re-export 别名（护住既有测试 import），但行为一律以 shared-utils 谓词为准。
- **替代方案（被否）**: ① 各包复制正则（沿用 retune-aging-exemptions D1 的最小改动精神）——该变更时清单仅一处消费，硬编码合理；出现第二消费方后复制即成本，被否。② 清单配置化（settings.json globs）——引入 glob 匹配语义、默认值合并、正则转义等新配置面，而清单调整频率低，不值得（retune D1 已论证，维持）。
- **影响**: pi-shared-utils 新增 `src/protected-docs.ts`（isSkillMdPath / isOpenspecDesignDocPath / isArchDocPath / isConstitutionalDocPath，v1.2.0 起）；pi-context-manager 的 distill-helpers.ts、pi-shepherd 的 context-restore.ts 均改为引用 + 本地 re-export 别名。未来第三个消费方（如 distill 注入、新扩展）出现时直接 import；清单再次调整只改 shared-utils 一处，三包联发顺序为 shared-utils 先行（下游 typecheck 依赖其导出，顺序天然强制）。
- **证据来源**: change unify-protected-doc-list / design.md 决策 D1
