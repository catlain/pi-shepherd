# Proposal: unify-protected-doc-list

## Why

pi-context-manager 的 aging 豁免清单已按 retune-aging-exemptions 调音（openspec 收窄为仅 design.md、新增架构宪法三件套），但 pi-shepherd 的 compact 回补（context-restore）仍是旧宽清单：openspec 下**全部 .md**（proposal/tasks/specs delta/主规格）都回补，多 change 并行时轻松挤爆 40K 预算；ADR/INVARIANTS/Design Note 反而不回补。同一份"保护文档"语义在两个包里各持一份清单且互不一致，已经分叉。

## What Changes

- **回补清单对齐 aging 调音后的清单**：openspec 收窄为仅 `openspec/changes/<change>/design.md`；新增 `docs/agent/adr/`、`docs/agent/adr-archive/`、`docs/agent/ADR.md`、`docs/agent/INVARIANTS.md`、`docs/agent/designs/` 四类架构文档；proposal.md、tasks.md、specs 增量、`openspec/specs/` 主规格不再回补
- **skills 匹配收形**：从“任意路径以 SKILL.md 结尾”改为任意目录树下 `skills/{name}/SKILL.md` 形态（单一 `skills` 路径段 + 单一技能名段 + 精确入口文件名，大小写不敏感）——覆盖 `.pi` 全局/项目级、npm 包、`.agents` 生态、git 包等所有真实技能目录；无 `skills/` 段的同名结尾文件（如 `docs/some-skill/SKILL.md`）不再误命中
- **清单沉淀 shared-utils 单一事实源**：新谓词（`isSkillMdPath` / `isOpenspecDesignDocPath` / `isArchDocPath` / 组合 `isConstitutionalDocPath`）沉淀到 `@pi-atelier/shared-utils`，pi-shepherd 与 pi-context-manager 均改为引用，消除双清单漂移
- pi-context-manager 的 aging 豁免同步换用 shared-utils 谓词：**行为变化**——技能目录下非 SKILL.md 文件（模板等）不再 aging 豁免（现状豁免目录下全部文件，收窄）；`.agents` 等非 `.pi` 树的 `skills/{name}/SKILL.md` 新增 aging 豁免（扩齐）；相对路径 `skills/{name}/SKILL.md` 保持命中

## Capabilities

### New Capabilities

- `protected-doc-list`: 保护文档清单谓词——三类保护路径（.pi 技能 SKILL.md、openspec change design.md、架构宪法文档）的匹配语义、单一事实源约束（清单逻辑 SHALL 只存在于 shared-utils）

### Modified Capabilities

- `context-restore`: 激活源 requirement 变更——谓词从"SKILL.md 结尾 OR openspec/ 段任意 .md"改为引用保护文档清单；openspec 全量回补收窄为 design.md，新增架构文档回补

## Impact

- `pi-shared-utils`：新增纯函数模块（零依赖，可进主 barrel）+ 发版
- `pi-context-manager`：`distill-helpers.ts` 的 `isSkillFilePath`/`isOpenspecDesignPath`/`isArchDocPath` 替换为 shared-utils 引用（本地保留 re-export 别名护住回归测试，详见 tasks）；aging 豁免单测按上述行为变化调整口径
- `pi-shepherd`：`context-restore.ts` 的 `isContextDocPath` 改为组合谓词调用；`context-restore.test.ts` 用例增删（`openspec/specs/**` → false、`docs/agent/**` 新增正反例、无 `skills/` 段的裸 `SKILL.md` → false）
- 用户可见行为：压缩后回补内容显著变少（仅 design.md + 架构文档 + 技能入口），40K 预算更耐用
- 三包联发：shared-utils 发 minor 1.2.0 先行，context-manager（依赖声明 `^1.1.1`）与 shepherd（`^1.0.0`）均须 `npm update` 刷新后发 patch
