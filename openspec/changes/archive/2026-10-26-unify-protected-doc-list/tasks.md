# Tasks: unify-protected-doc-list

## 1. shared-utils：保护文档清单谓词（先行，下游依赖）

- [x] 1.1 在 pi-shared-utils 新增 `protected-docs.ts`：导出 `isSkillMdPath` / `isOpenspecDesignDocPath` / `isArchDocPath` / `isConstitutionalDocPath`（纯字符串零依赖；签名 `(path: string | undefined): boolean`，undefined → false；正则按 design D2/D3/D4，skills 为任意目录树 `skills/{name}/SKILL.md` 单段结构；兼容 `/` 与 `\`，SKILL.md 大小写不敏感），并在主 barrel `index.ts` re-export
- [x] 1.2 新增 `protected-docs.test.ts`：覆盖 spec 全部 scenario——技能各目录树正例（.pi 全局/npm 包/项目级/.agents/git 包/相对路径）、无 `skills/` 段的裸 `SKILL.md` 与非入口文件名反例、`filePath: undefined` → false、openspec 仅 design.md 正例（含反斜杠形态）、proposal/tasks/specs 反例、docs/agent 四类正例、`docs/ADR.md` 与 `results/designs/` 反例、组合 OR 语义
- [x] 1.3 `npm run typecheck` + `npm test` 全绿 → 按 npm-publish 技能发 minor **1.2.0**（不可发 1.1.0：context-manager 依赖声明 `^1.1.1` 解析不到）→ `npm view @pi-atelier/shared-utils version` 验证

## 2. pi-context-manager：aging 豁免换用单一事实源

- [x] 2.1 `distill-helpers.ts`：删除本地 `isSkillFilePath` / `isOpenspecDesignPath` / `isArchDocPath` 实现，改为 import `@pi-atelier/shared-utils`；本地保留 re-export 别名护住 `aging-exempt-regression.test.ts`（引用本地函数名）等既有测试的 import（`isAgingExempt` 消费形态不变：仍限 read 工具）；`distill-helpers-skill.test.ts` 若直测本地函数签名则改为引用新谓词名
- [x] 2.2 调整 aging 豁免单测（设计声明的行为变化，现状基线 = 技能目录下全部文件豁免、含项目级短路分支）：技能目录非 SKILL.md 文件（模板等，含项目级/相对路径形态）→ 不再豁免（新增反例，如 `{cwd}/.pi/skills/{name}/templates/tpl.md`）；`.agents/skills/{name}/SKILL.md` → 新增豁免（新增正例）；相对路径 `skills/{name}/SKILL.md` → 保持命中；其余 openspec/arch 既有用例口径不变仍须通过
- [x] 2.3 `npm update @pi-atelier/shared-utils`（lock 内旧版 `npm install` 不升级）→ `npm ls @pi-atelier/shared-utils` 确认 ≥1.2.0 → `npm run typecheck` + `npm test` 全绿 → git commit + 发 patch 版本

## 3. pi-shepherd：compact 回补清单对齐

- [x] 3.1 `shepherd/context-restore.ts`：`isContextDocPath` 删除本地实现，改为 import `isConstitutionalDocPath`（filterContextDocs 调用点签名不变）；模块头注释更新——回补范围重述为"保护文档清单（技能 SKILL.md + change design.md + docs/agent 架构文档）"，删除"proposal/design/tasks/spec 全量回补"旧描述
- [x] 3.2 `context-restore.test.ts` 增删用例：`openspec/changes/c/specs/x/spec.md`、`openspec/specs/c/spec.md` → false；`openspec/changes/c/design.md` 保持 true；`docs/agent/ADR.md`、`docs/agent/designs/x.md`、`docs/agent/adr/0001-x.md` → true；`docs/ADR.md`（非 agent 段）→ false；`.agents/skills/x/SKILL.md`、项目级 `.pi/skills/x/SKILL.md` → true；`docs/some-skill/SKILL.md`（无 `skills/` 目录段）→ false；既有 resume/跨压缩接力/数组序用例保持通过不动
- [x] 3.3 `npm update @pi-atelier/shared-utils` → `npm ls` 确认 ≥1.2.0 → `npm run typecheck` + `npm test` 全绿 → git commit + 发 patch 版本

## 4. 验证与归档

- [x] 4.1 三包 `npm ls @pi-atelier/shared-utils` 确认均解析到 1.2.0（✓ 1.2.0/1.2.0/1.2.0）；grep 确认两包源码中不再存在清单正则副本（✓ 下游无副本）
- [x] 4.2 验证：真实路径端到端判定 8/8 符合预期（Node 24 直跑 TS 谓词：design.md 保护、tasks/proposal 忽略、三类技能 SKILL.md 保护、源码忽略）；完整压缩回补待用户下次压缩时观察（restore-log 可查证）
- [x] 4.3 全部仓库提交推送后运行 `/opsx-archive unify-protected-doc-list`（含 ADR 沉淀：新增 ADR-0004「跨包共享清单逻辑沉淀 shared-utils 单一事实源」）——已完成归档
