# context-restore Delta Spec

## MODIFIED Requirements

### Requirement: 上下文激活源（事件 payload）

shepherd SHALL 以 `session_compact` 事件 payload 的 `compactionEntry.details.readFiles` 为激活源：该清单（宿主语义 = 上次压缩 readFiles 继承 ∪ 本次挥发窗口内全部 read 调用）经纯函数谓词过滤——命中条件为以下之一：路径以 `SKILL.md` 结尾（大小写不敏感），或规范化路径含 `openspec/` 路径段且以 `.md` 结尾——后作为恢复候选清单。SHALL NOT 维护进程内存态激活集（不挂 `tool_execution_start`、不做 existsSync 预检、不做 Set 重读移尾），SHALL NOT 持久化自有激活状态；readFiles 中双条件均不满足的路径不进入候选清单。

#### Scenario: 挥发窗口内的受保护 read 进入候选清单
- **WHEN** 压缩发生且 readFiles 含 `.../openspec/changes/foo/design.md` 与 `.../skills/bar/SKILL.md`
- **THEN** 两路径经谓词命中，作为候选清单传入恢复决策

#### Scenario: resume 后跨进程恢复
- **WHEN** 会话经 /resume 重启（新进程无自有状态）后发生压缩，readFiles 含重启前旧进程 read 过的 SKILL.md
- **THEN** 该 SKILL.md 仍进入候选清单并参与恢复（宿主 jsonl 连续统计）

#### Scenario: 跨压缩接力（继承链）
- **WHEN** 同一会话第二次压缩，两次压缩间未再 read 该文档，但上次 readFiles 含它
- **THEN** 宿主继承链保证本次 readFiles 仍含该路径，恢复候选不丢失

#### Scenario: 非 openspec 的普通 .md 不进入候选
- **WHEN** readFiles 含 `docs/agent/ADR.md` 与 `README.md`
- **THEN** 谓词不命中，不进入候选清单

#### Scenario: 数组序即激活序
- **WHEN** readFiles 继承段在前、本次窗口 read 按消息序追加
- **THEN** 候选清单尾部为最近激活，预算截断从最旧端放弃

### Requirement: 压缩后持久恢复注入

`session_compact` 事件后，若候选清单（谓词过滤后的 readFiles）非空且 contextRestore 启用，shepherd SHALL 调用 `sendMessage({ customType: "shepherd.contextRestore", content: 恢复正文, display: false }, {})` 持久写入 session 树（no-triggerTurn）；恢复正文含各文档的边界标记（`上下文恢复: <basename> (<path>)`）与完整正文；注入条目经宿主投影进入压缩后所有后续 provider request。SHALL NOT 调用 sendMessage(triggerTurn)。

#### Scenario: 注入条目结构
- **WHEN** 压缩发生且候选清单含 1 个 SKILL.md + 2 个 openspec 文档
- **THEN** sendMessage 以 display:false、无 triggerTurn 调用一次，content 含三个条目的边界标记与读盘正文

#### Scenario: 空候选清单可观测
- **WHEN** 压缩发生且谓词过滤后候选清单为空（readFiles 无受保护文档）
- **THEN** 不调用 sendMessage，输出 debug 级 notify 说明"无可恢复对象"（区别于恢复失败静默）

#### Scenario: 多次压缩自愈重注
- **WHEN** 同一会话第二次压缩（上次恢复条目已随压缩挥发）
- **THEN** readFiles 继承链保证候选清单仍含受保护文档，再次注入恢复条目

#### Scenario: 子代理跳过恢复
- **WHEN** 子代理（isSubagent()=true）发生压缩
- **THEN** 不执行恢复注入
