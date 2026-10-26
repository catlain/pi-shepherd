# context-restore Delta Spec

## MODIFIED Requirements

### Requirement: 上下文激活源（事件 payload）

shepherd SHALL 以 `session_compact` 事件 payload 的 `compactionEntry.details.readFiles` 为激活源：该清单（宿主语义 = 上次压缩 readFiles 继承 ∪ 本次挥发窗口内全部 read 调用）经保护文档清单谓词 `isConstitutionalDocPath`（来自 `@pi-atelier/shared-utils` 单一事实源，= 任意目录树 `skills/{name}/SKILL.md` ∪ `openspec/changes/{change}/design.md` ∪ `docs/agent/` 前缀架构文档）过滤后作为恢复候选清单。SHALL NOT 维护进程内存态激活集（不挂 `tool_execution_start`、不做 existsSync 预检、不做 Set 重读移尾），SHALL NOT 持久化自有激活状态；readFiles 中谓词不命中的路径不进入候选清单。openspec 变更工作文档中仅 `design.md` 受保护（proposal.md、tasks.md、specs 增量、`openspec/specs/` 主规格均不回补——旧快照留在上下文是负资产，挥发逼着重读拿实况）。

#### Scenario: 挥发窗口内的受保护 read 进入候选清单
- **WHEN** 压缩发生且 readFiles 含 `.../openspec/changes/foo/design.md`、`.../.pi/agent/skills/bar/SKILL.md`、`.../docs/agent/INVARIANTS.md`
- **THEN** 三路径经 `isConstitutionalDocPath` 命中，作为候选清单传入恢复决策

#### Scenario: openspec 非 design 文档不再回补
- **WHEN** 压缩发生且 readFiles 含 `.../openspec/changes/foo/proposal.md`、`.../openspec/changes/foo/tasks.md`、`.../openspec/changes/foo/specs/x/spec.md`、`.../openspec/specs/context-restore/spec.md`
- **THEN** 谓词均不命中，不进入候选清单（不注入、不点名）

#### Scenario: 无 skills 目录段的裸 SKILL.md 不回补
- **WHEN** 压缩发生且 readFiles 含 `C:/r/docs/some-skill/SKILL.md`（无 `skills/{name}/` 目录段结构）
- **THEN** 谓词不命中，不进入候选清单

#### Scenario: resume 后跨进程恢复
- **WHEN** 会话经 /resume 重启（新进程无自有状态）后发生压缩，readFiles 含重启前旧进程 read 过的受保护文档
- **THEN** 该文档仍进入候选清单并参与恢复（宿主 jsonl 连续统计）

#### Scenario: 跨压缩接力（继承链）
- **WHEN** 同一会话第二次压缩，两次压缩间未再 read 该受保护文档，但上次 readFiles 含它
- **THEN** 宿主继承链保证本次 readFiles 仍含该路径，恢复候选不丢失

#### Scenario: 数组序即激活序
- **WHEN** readFiles 继承段在前、本次窗口 read 按消息序追加
- **THEN** 候选清单尾部为最近激活，预算截断从最旧端放弃
