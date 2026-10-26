# protected-doc-list Specification

## Purpose

"保护文档" = 跨包共享的高价值长期在场文档清单（技能入口 SKILL.md、openspec 变更决策 design.md、架构宪法文档），由 `@pi-atelier/shared-utils` 的谓词族作为单一事实源提供匹配逻辑。两个消费方（pi-context-manager 的 aging 豁免、pi-shepherd 的 compact 回补）引用同一谓词，保证"读后不被遗忘（aging）"与"压缩后全文复活（回补）"两端清单永不分叉。本能力界定清单的路径形态语义与单一事实源约束。

## Requirements

### Requirement: 保护文档清单谓词（shared-utils 单一事实源）

`@pi-atelier/shared-utils` SHALL 导出保护文档清单谓词族：`isSkillMdPath(path)`、`isOpenspecDesignDocPath(path)`、`isArchDocPath(path)` 与组合函数 `isConstitutionalDocPath(path)`（= 前三者 OR）。保护文档清单的匹配逻辑 SHALL 仅存在于 shared-utils（单一事实源）；下游包（pi-context-manager、pi-shepherd）SHALL 引用该谓词族，SHALL NOT 复制清单正则。

`isSkillMdPath` SHALL 命中且仅命中任意目录树下的技能入口文档 `skills/{name}/SKILL.md`（单一 `skills` 路径段 + 单一技能名段，文件名大小写不敏感；无 `skills/` 段的同名结尾文件不命中）。真实覆盖形态含：全局 `~/.pi/agent/skills/`、npm 包 `~/.pi/agent/npm/node_modules/{pkg}/skills/`、项目级 `{cwd}/.pi/skills/`、`.agents` 生态（`~/.agents/skills/`）、git 包 `~/.pi/agent/git/**/skills/`。

`isOpenspecDesignDocPath` SHALL 命中且仅命中 `openspec/changes/{change}/design.md`（`{change}` 为单一路径段，文件名精确）。

`isArchDocPath` SHALL 命中且仅命中 `docs/agent/` 前缀下的架构文档：`docs/agent/adr/**`、`docs/agent/adr-archive/**`、`docs/agent/ADR.md`、`docs/agent/INVARIANTS.md`、`docs/agent/designs/**`。

所有谓词签名 SHALL 为 `(path: string | undefined): boolean`（undefined 输入返回 false，兼容下游直接传 `ctx.filePath`），SHALL 兼容 `/` 与 `\` 路径分隔符及绝对/相对路径形态。

#### Scenario: 技能入口文档各目录树形态命中
- **WHEN** 输入 `C:/Users/u/.pi/agent/skills/code-graph/SKILL.md`、`C:/Users/u/.pi/agent/npm/node_modules/pi-worktree/skills/worktree-setup/SKILL.md`、`C:/proj/.pi/skills/my-skill/SKILL.md`、`C:/Users/u/.agents/skills/skill-creator/SKILL.md`、`C:/Users/u/.pi/agent/git/github.com/catlain/foo/skills/bar/SKILL.md`、相对路径 `skills/code-graph/SKILL.md`
- **THEN** `isSkillMdPath` 对全部返回 true

#### Scenario: 无 skills 目录段或不匹配入口形态不命中
- **WHEN** 输入 `C:/r/docs/some-skill/SKILL.md`（无 `skills/` 段）、`C:/r/.pi/skills/foo/templates/tpl.md`（非入口文件名）
- **THEN** `isSkillMdPath` 返回 false

#### Scenario: openspec 仅 change design.md 命中
- **WHEN** 输入 `C:/r/openspec/changes/add-x/design.md`（含反斜杠形态 `C:\r\openspec\changes\add-x\design.md`）
- **THEN** `isOpenspecDesignDocPath` 返回 true
- **WHEN** 输入 `C:/r/openspec/changes/add-x/proposal.md`、`C:/r/openspec/changes/add-x/tasks.md`、`C:/r/openspec/changes/add-x/specs/c/spec.md`、`C:/r/openspec/specs/context-restore/spec.md`
- **THEN** `isOpenspecDesignDocPath` 均返回 false

#### Scenario: 架构文档四类命中且 docs/agent 前缀防误伤
- **WHEN** 输入 `C:/r/docs/agent/adr/0001-x.md`、`C:/r/docs/agent/adr-archive/0000-y.md`、`C:/r/docs/agent/ADR.md`、`C:/r/docs/agent/INVARIANTS.md`、`C:/r/docs/agent/designs/subsystem.md`
- **THEN** `isArchDocPath` 均返回 true
- **WHEN** 输入 `C:/r/docs/ADR.md`（缺 agent 段）或 `C:/r/results/designs/x.md`（非 docs/agent 前缀）
- **THEN** `isArchDocPath` 均返回 false

#### Scenario: 组合谓词 OR 语义
- **WHEN** 输入任一细分谓词命中的路径（三类各一，含 `.agents/skills/x/SKILL.md`）
- **THEN** `isConstitutionalDocPath` 均返回 true；三类之外的普通业务文档（如 `C:/r/src/index.ts`、`C:/r/README.md`）返回 false
