# Tasks: extend-context-restore

## 1. 谓词与源文件更名

- [x] 1.1 `git mv shepherd/skill-restore.ts shepherd/context-restore.ts` + 同步 barrel（`shepherd/index.ts`）、`compaction.ts` 的 import 与命名导出（`registerSkillTracker` → `registerContextTracker`、`DEFAULT_SKILL_RESTORE` → `DEFAULT_CONTEXT_RESTORE`）
- [x] 1.2 谓词泛化：`isSkillRead` → `isContextDocRead`——SKILL.md 后缀（大小写不敏感）OR 规范化路径含 `openspec/` 段且 `.md` 结尾；保留 existsSync 预检
- [x] 1.3 激活集记录函数与状态注释同步泛化命名（`_activeSkills` → `_activeDocs`），行为不变（Set 重读移尾）
- [x] 1.4 `index.ts` 挂载点调用名同步（`registerContextTracker`）

## 2. 决策与注入更名

- [x] 2.1 `buildRestoreDecision`：边界标记文案 `技能恢复: <name> (<path>)` → `上下文恢复: <basename> (<path>)`
- [x] 2.2 customType `shepherd.skillRestore` → `shepherd.contextRestore`（compaction.ts 注入调用 + details 字段命名同步）
- [x] 2.3 预算约束收敛：仅保留 `maxTokens`（默认 20000 → 40000），**删除 maxSkills/maxItems 条目上限**（不限文档个数）；估算函数沿用（按字符近似）
- [x] 2.4 配置键读取：`getEffectiveConfig("shepherd", { ..., contextRestore: DEFAULT_CONTEXT_RESTORE })`——无旧键兼容

## 3. compaction-reminder 联动文案

- [x] 3.1 降级 notify 文案："已恢复技能: …" → "已恢复上下文文档: …"
- [x] 3.2 steer 提醒与 skipped 点名文案："技能正文/重读技能" → "上下文文档正文/重新 read"

## 4. 测试同步

- [x] 4.1 `git mv tests/skill-restore.test.ts tests/context-restore.test.ts` + 头注释/描述名同步
- [x] 4.2 新增谓词测试：openspec design.md / 主 spec 命中、普通 .md（README.md、ADR.md）不命中、大小写 SKILL.md 变体
- [x] 4.3 预算测试更新：仅 maxTokens 约束（默认 40000、超限截断点名；无条目上限用例）
- [x] 4.4 注入结构测试：customType shepherd.contextRestore、边界标记文案
- [x] 4.5 index-compaction.test.ts 联动测试同步（降级/维持/点名三场景文案断言）

## 5. 配置命令 /compact-config

- [x] 5.1 新建 `shepherd/commands.ts`：registerCompactConfigCommand(pi)——无参查看（当前值+用法）/ 裸数字设 maxTokens / `on|off` 开关 / 无效值拒绝，全部经 ctx.ui.notify 反馈（对照 /aging-config 生态模式）
- [x] 5.2 `setContextRestoreConfig(patch)` 薄封装（读当前完整配置→浅合并 patch→patchSettingsSection("shepherd", { contextRestore: 整体 })）
- [x] 5.3 index.ts 挂载命令注册
- [x] 5.4 命令测试（tests/compact-config.test.ts：无参/裸数字设 maxTokens/off/on/无效值，settings 写入 mock）

## 6. 真机冒烟验收

- [x] 6.1 清 jiti 缓存 → reload → read 一个 SKILL.md + 一个 openspec/changes/*/design.md → `/compact` → 验收：恢复条目含两个文档正文（上下文内可见）、日志无异常、jsonl 含 shepherd.contextRestore 条目；顺带 `/compact-config` 无参查看与设值验证
- [x] 6.2 冒烟通过后：`git rm -r openspec/specs/skill-restore/`（主 spec 由归档时 context-restore 接管）
