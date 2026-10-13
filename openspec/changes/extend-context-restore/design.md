# Design: extend-context-restore

Affects-subsystem: uncategorized

## Context

skill-restore（v0.3.0，change add-skill-restore-injection）已交付：`tool_execution_start` 激活记录（existsSync 预检）→ 模块级 Set → `session_compact` 时 `buildRestoreDecision`（maxSkills/maxTokens 双闸，最近激活优先）→ `sendMessage({customType:"shepherd.skillRestore", display:false})` 持久注入 → 恢复成功时 compaction-reminder 降级为 ui.notify、截断时 skipped 名单点名。全部机制经六轮真机调试验证。

本变更是谓词与命名的泛化：保护对象从 SKILL.md 扩到 openspec .md，能力更名为 context-restore。**管线架构零改动**（ADR-0002 旁挂模式延续）。

## Goals & Non-Goals

**Goals**：
- read 过的 openspec 文档在压缩后自动恢复正文
- 命名/配置/注入类型与泛化后语义一致（context-restore）
- 预算默认值适配文档体量（design.md 单文件上万 token）
- compaction-reminder 联动文案同步泛化

**Non-Goals**：
- AGENTS.md / CLAUDE.md 等系统提示词文件的保护（宿主实证：system prompt 不参与压缩，compaction.js L50 显式 `filter(role !== "system")`）
- 按内容类型分池预算（单池最近优先已够用，分池留待真实需求出现）
- branchEntries 历史扫描补录（维持 D2 既有否决）
- 非 openspec 的普通文档（README、ADR、docs/）——第一版明确收窄，避免激活集爆炸

## Decisions

### D1 保护对象谓词：SKILL.md ∪ openspec/**/*.md

谓词泛化为两个 OR 分支：路径以 `SKILL.md` 结尾（大小写不敏感，既有行为）或规范化路径含路径段 `openspec/`（正斜杠归一后匹配）且以 `.md` 结尾。covers changes/ 三件套、delta specs、主 specs、archive、未来 map 等一切 openspec 产物。**单池单序**：技能与文档共入同一激活集（Set 重读移尾），预算共享。

- **Type**: one-off
- **Sediment-to**: none

### D2 能力更名一次到位：skill-restore → context-restore

spec 目录、配置键（`shepherd.skillRestore` → `shepherd.contextRestore`）、注入 customType（`shepherd.skillRestore` → `shepherd.contextRestore`）、源文件名（`skill-restore.ts` → `context-restore.ts`）同步更名。v0.3.0 发布不足一小时、无外部用户依赖，**不做旧键兼容映射**（0.x 阶段允许 breaking，兼容层是长期债务）。主 specs 侧 skill-restore spec 由本变更归档时删除，context-restore spec 接管。

- **Type**: one-off
- **Sediment-to**: none

### D3 预算约束：仅 maxTokens（不限文档个数）

**删除 maxItems 条目上限**：仅保留 maxTokens 预算约束（默认 20000 → 40000，openspec design.md 实测可上万 token）。不限文档个数——预算内能装多少装多少，超限按最近激活优先截断 + skipped 点名，不静默。理由：条目数是间接约束，token 才是真实预算；少一个配置面，用户心智更简。

- **Type**: one-off
- **Sediment-to**: none

### D4 恢复条目与点名文案泛化措辞

注入正文边界标记从 `技能恢复: <name>` 泛化为 `上下文恢复: <basename> (<path>)`；compaction-reminder 的降级 notify 与 skipped 点名文案从"技能正文/重读技能"改为"上下文文档正文/重新 read"。类别字面量不区分技能与文档（第一版共用一套文案，避免分类配置面）。

- **Type**: one-off
- **Sediment-to**: none

### D5 架构归属不变：延续 ADR-0002 旁挂

管线（事件挂载、Set、决策、注入、联动）架构与 v0.3.0 完全一致，仅谓词/命名/默认值/文案变化。ADR-0002（框架内建行为独立模块旁挂）继续治理本能力。

- **Type**: one-off
- **Sediment-to**: none

### D6 配置命令：/compact-config（对照生态惯例）

对照 pi-context-manager 的 /aging-config 生态模式（registerCommand + 无参查看含用法 + notify 确认），提供 `/compact-config`：无参查看当前配置与用法；`/compact-config N` 设 maxTokens（唯一数字参数，裸数字）；`/compact-config on|off` 开关。写入经薄封装 `setContextRestoreConfig` → shared-utils 的 `patchSettingsSection("shepherd", { contextRestore: 整体对象 })`（该函数浅合并嵌套对象，故先读当前完整配置→改字段→整体写回；文件锁+备份由 shared-utils 保证）。命令注册放独立 `shepherd/commands.ts`（index.ts 已 275 行超阈值，不加重债务；单独文件跟随 pi-context-manager 先例）。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- **激活集膨胀**：openspec 会话常 read 5+ 文档，预算截断后技能可能被挤掉——单池最近优先是接受的取舍（最近 read 的最可能仍被需要）；真实痛点出现再考虑分池
- **重复注入**：多 change 并行时 read 多份 design.md，压缩后全量恢复占上下文——预算上限天然兜底
- **主 spec 删除 skill-restore**：openspec 工具链对 spec 目录删除无专用命令，归档时手动 `git rm` + context-restore 新建，README/INDEX 无引用需检查

## Migration Plan

1. 源文件/测试改名 + 谓词/默认值/文案修改（单 PR 内原子完成）
2. 主 specs：删除 `openspec/specs/skill-restore/`，本变更归档时 context-restore spec 落地
3. 配置键无迁移：旧键 `shepherd.skillRestore` 用户未配置过（本机默认启用未显式写 settings），无感
