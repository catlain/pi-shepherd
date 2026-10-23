# Proposal: extend-context-restore

## Why

skill-restore（v0.3.0）只保护 SKILL.md，但实施 openspec 变更期间 read 的设计文档（proposal/design/tasks/spec）压缩挥发后**连索引都没有**——比技能更裸：AI 凭残影引用设计决策（D1~D7），跑偏无从察觉。本会话六轮调试刚验证了恢复管线的全部机制可用，泛化成本最低的时机就是现在。

## What Changes

- **谓词泛化**：`SKILL.md` → `SKILL.md 或 openspec/ 目录下的 .md`（全量：changes 三件套、delta specs、主 specs、未来 map 等）
- **能力更名**：skill-restore → **context-restore**（spec 目录、配置键 `shepherd.skillRestore` → `shepherd.contextRestore`、注入类型 `shepherd.skillRestore` → `shepherd.contextRestore`——v0.3.0 发布不足一小时，无兼容负担，直接更名）
- **预算调整**：仅保留 `maxTokens`（20000 → 40000，design.md 单文件可上万 token）；**删除 maxSkills/maxItems 条目上限**——不限文档个数，预算内能装多少装多少
- **AGENTS.md 不纳入**：宿主实证 system prompt 不参与压缩（compaction.js 显式 filter 掉 role:system），无需保护
- **截断点名语义保持**：仅在预算截断发生时提醒未恢复清单（全量注入零提示）
- **恢复成功降级提醒联动**：compaction-reminder 的提醒文案从"技能"泛化为"上下文文档"

## Capabilities

### New Capabilities
- `context-restore`: 泛化上下文恢复——激活记录（SKILL.md + openspec .md）、压缩后持久注入、双预算保护、截断点名、配置开关（吞并并取代 skill-restore）

### Modified Capabilities
- `compaction-reminder`: 提醒文案与恢复联动的语义从"技能正文"泛化为"上下文文档正文"；联动降级/维持/点名三 Scenario 措辞同步
