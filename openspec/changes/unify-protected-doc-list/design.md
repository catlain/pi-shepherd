# Design: unify-protected-doc-list

Affects-subsystem: uncategorized

## Context

"保护文档"语义在两个包里各持一份清单且互不一致：

- **pi-context-manager**（aging 豁免，`distill-helpers.ts`）：retune-aging-exemptions 已调音——skills（AGENT_DIR 限定）、`openspec/changes/*/design.md`（仅此）、架构宪法三件套（`docs/agent/adr/`、`adr-archive/`、`ADR.md`、`INVARIANTS.md`、`designs/`）
- **pi-shepherd**（compact 回补，`context-restore.ts` 的 `isContextDocPath`）：旧宽清单——任意路径 `SKILL.md` 结尾 + `openspec/` 段下**任意** `.md`（proposal/tasks/specs delta/主规格全回补），无架构文档

后果：多 change 并行时 openspec 全量回补挤爆 40K 预算；ADR/INVARIANTS/Design Note 压缩挥发后无人回补；第三次调整清单需同步两处硬编码。用户已拍板：① skills 匹配改为任意目录树下 `skills/{name}/SKILL.md` 形态（含 `.pi`、`.agents`、git 包等所有真实技能目录），② 清单沉淀 shared-utils 单一事实源。

约束：两个下游包均已依赖 `@pi-atelier/shared-utils`（shepherd 已用 getEffectiveConfig/drainHints/filter-match，context-manager 已用配置 API）；shared-utils 主 barrel 不引重依赖（现有规范）；pi-shepherd 变更仓库无 Design Note 注册表（ADR 全部 uncategorized）。

## Goals / Non-Goals

**Goals:**

- shared-utils 新增保护文档清单谓词：`isSkillMdPath` / `isOpenspecDesignDocPath` / `isArchDocPath` / 组合 `isConstitutionalDocPath`，纯字符串零依赖
- pi-shepherd 回补谓词换用 `isConstitutionalDocPath`，清单对齐 aging 调音结果
- pi-context-manager aging 豁免换用同一谓词族，消除双清单
- 两包单测按新清单完整覆盖正反例（含项目级 `.pi/skills`、`docs/ADR.md` 非 agent 段等边界）

**Non-Goals:**

- 不做清单配置化（settings.json globs）——沿用 retune-aging-exemptions D1 结论
- 不改回补注入机制（sendMessage/display:false/预算截断）、`/compact-config` 命令形态、aging 阈值数值语义
- 不处理 edit/write 的 Infinity 阈值路径
- 不动 shared-utils 其他模块的 barrel 结构

## Decisions

### D1 清单沉淀 shared-utils，跨包共享逻辑归属 shared-utils 层

保护文档清单是两个以上包消费的领域语义（aging 豁免 + compact 回补，未来 distill/注入等可能复用），SHALL 只在 `@pi-atelier/shared-utils` 存在一份实现；下游包（pi-context-manager、pi-shepherd）SHALL 引用而非复制正则。备选"各包复制正则"（沿用 retune D1 精神）被否：清单已出现第二次调整，漂移成本已被证实，复制方案正是本变更要消除的分叉根源。

- **Type**: layering-principle
- **Sediment-to**: ADR

### D2 skills 谓词收形为任意目录树下 `skills/{name}/SKILL.md`

正则锚定单一 `skills` 路径段 + 单一技能名段 + 精确文件名 `SKILL.md`（大小写不敏感，`/(^|[\\/])skills[\\/][^\\/]+[\\/]SKILL\\.md$/i`），替代现状“任意路径以 SKILL.md 结尾”。理由：用户拍板“任意 skills 目录都收”——覆盖全部真实技能形态：全局 `~/.pi/agent/skills/`、npm 包 `~/.pi/agent/npm/node_modules/{pkg}/skills/`、项目级 `{cwd}/.pi/skills/`、`.agents` 生态（如 skill-creator）、git 包 `~/.pi/agent/git/**/skills/`；业务目录同形态误命中面由用户接受（代价：偶发业务 `skills/x/SKILL.md` 常驻，低于旧宽松 endsWith 的误伤面）。附带效应（aging 侧现状 = `skills/{name}/` 目录下全部文件豁免，含项目级短路分支）：非 SKILL.md 技能文件（模板等）不再豁免（收窄，SKILL.md 保留入口指引，需要时重读）；`.agents` 等非 `.pi` 树 SKILL.md 新增豁免（扩齐）；相对路径 `skills/{name}/SKILL.md` 保持命中；回补侧无 `skills/` 段的裸 `SKILL.md` 结尾文件（如 `docs/some-skill/SKILL.md`）不再回补。

- **Type**: one-off
- **Sediment-to**: none

### D3 谓词族形态：三个细分函数 + 一个组合函数，纯字符串零依赖进主 barrel

细分函数（`isSkillMdPath`/`isOpenspecDesignDocPath`/`isArchDocPath`）保持 retune 变更 D3 的语义域隔离（技能 / openspec 变更决策 / 架构宪法），组合函数 `isConstitutionalDocPath = 三者 OR` 供回补侧整体消费；aging 侧按需组合（现有 `isAgingExempt` 的消费形态不变）。全部为纯字符串函数、零依赖，可直接进 shared-utils 主 barrel（不违反“重依赖走子路径”规范）。路径形态兼容 `/` 与 `\`（`(^|[\\/])` 锚定），绝对/相对路径均可判；签名统一 `(path: string | undefined): boolean`——现状下游直接传 `ctx.filePath`（可能 undefined），保持兼容。

- **Type**: one-off
- **Sediment-to**: none

### D4 openspec 与架构文档谓词直接沿用 retune 调音后的正则语义

`isOpenspecDesignDocPath` = `(^|[\\/])openspec[\\/]changes[\\/][^\\/]+[\\/]design\.md$`（仅 change 名下 design.md）；`isArchDocPath` = retune D3 四类（`docs/agent/adr/`、`adr-archive/`、`ADR.md`、`INVARIANTS.md`、`designs/`，`docs/agent/` 前缀防误伤）。回补侧不再回补 proposal/tasks/specs delta/主规格——与 aging D2 互证：留在上下文的旧快照是负资产，挥发逼着重读拿实况。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [三包联发版本对齐：shared-utils 加函数后下游 npm 范围依赖需主动刷新] → 发布顺序硬约束：shared-utils 先发 minor（1.2.0，两包现有声明 `^1.0.0` 与 `^1.1.1` 均可解析；发 1.1.0 会被 context-manager 的 `^1.1.1` 排除）→ 下游 `npm update @pi-atelier/shared-utils` 刷新 lock（lock 内已满足范围的旧版 `npm install` 不升级）→ context-manager / shepherd 各自发 patch；下游在 shared-utils 发版前无法通过 typecheck（缺导出），顺序天然强制
- [aging 侧 skills 收窄：技能模板 read 后 10 轮淘汰] → 用户已知情；SKILL.md 入口常在，模板按需重读成本低于常驻
- [回补收窄后长实施会话丢 tasks/specs 上下文] → design.md 决策常驻（回补+豁免双保险）；tasks 挥发逼着重读实况，与 aging 侧行为对称
- [正则误伤：业务 `skills/` 目录同形态 SKILL.md 会被命中常驻] → 用户已接受（旧宽松 endsWith 误伤面更广，属收窄而非扩大）；`skills/{name}/` 单段结构 + 精确文件名锚定排除裸 `SKILL.md` 结尾误命中，单测覆盖 `docs/some-skill/SKILL.md`（false）、`.agents/skills/x/SKILL.md`（true）等正反例
- [shared-utils 主 barrel 体积] → 纯字符串函数零依赖，无重依赖泄漏风险

## Migration Plan

1. shared-utils：新增 `protected-docs.ts` + 单测 → typecheck + vitest → 发 minor 1.2.0
2. pi-context-manager：`distill-helpers.ts` 本地三函数（`isSkillFilePath`/`isOpenspecDesignPath`/`isArchDocPath`）替换为 shared-utils 引用 + 本地 re-export 别名护住回归测试，aging 豁免单测按 D2 行为变化调整（非 SKILL.md 技能文件 → 不豁免；`.agents` 树 SKILL.md → 豁免）→ `npm update @pi-atelier/shared-utils` → 发 patch
3. pi-shepherd：`context-restore.ts` 的 `isContextDocPath` 改为 `isConstitutionalDocPath`，模块头注释同步（回补范围重述）→ `npm update @pi-atelier/shared-utils` → 测试增删 → 发 patch
4. 回滚 = 各包 revert 提交，无数据迁移

## Open Questions

（无——skills 形态、单一事实源归属均已由用户在探索阶段拍板）
