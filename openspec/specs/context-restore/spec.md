# context-restore Specification

## Purpose

上下文压缩会把保护文档（技能入口 SKILL.md、openspec 变更决策 design.md、架构宪法文档）的正文从上下文挥发掉，导致 AI 忘记自己拥有的能力、进行中的规划决策与架构约束。本能力在每次压缩（手动 /compact、阈值 threshold、溢出 overflow）后自动把挥发窗口内读过的保护文档正文重新注入会话。回补范围 = 保护文档清单（单一事实源见 protected-doc-list 能力，与 aging 豁免共享）。激活源为宿主 `session_compact` 事件 payload 的 `compactionEntry.details.readFiles`（继承 ∪ 挥发窗口语义，跨 /resume 进程重启连续），shepherd 自身不维护任何进程内存态激活状态。

## Requirements

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

### Requirement: 压缩后持久恢复注入

`session_compact` 事件后，若候选清单（谓词过滤后的 readFiles）非空且 contextRestore 启用，shepherd SHALL 调用 `sendMessage({ customType: "shepherd.contextRestore", content: 恢复正文, display: false }, {})` 持久写入 session 树（no-triggerTurn）；恢复正文含各文档的边界标记（`上下文恢复: <basename> (<path>)`）与完整正文；注入条目经宿主投影进入压缩后所有后续 provider request。SHALL NOT 调用 sendMessage(triggerTurn)。

#### Scenario: 注入条目结构
- **WHEN** 压缩发生且候选清单含 1 个 SKILL.md + 2 个 openspec 文档
- **THEN** sendMessage 以 display:false、无 triggerTurn 调用一次，content 含三个条目的边界标记与读盘正文

#### Scenario: 空候选清单可观测
- **WHEN** 压缩发生且谓词过滤后候选清单为空（readFiles 无受保护文档）
- **THEN** 不调用 sendMessage，写审计日志 empty 行（`~/.pi/agent/logs/shepherd-restore.log`），区别于恢复失败静默（TUI ui.notify 实测不可见，观测一律走文件日志）

#### Scenario: 多次压缩自愈重注
- **WHEN** 同一会话第二次压缩（上次恢复条目已随压缩挥发）
- **THEN** readFiles 继承链保证候选清单仍含受保护文档，再次注入恢复条目

#### Scenario: 子代理跳过恢复
- **WHEN** 子代理（isSubagent()=true）发生压缩
- **THEN** 不执行恢复注入

### Requirement: token 预算保护与截断点名

恢复注入 SHALL 仅受 maxTokens（默认 40000）预算约束（不限文档个数）：超出时按候选清单尾部（最近激活）优先保留，被截断文档 SHALL NOT 静默丢弃，SHALL 进入未恢复名单由提醒文本点名；全量注入时写 ok 审计行（无 TUI 提示）。

#### Scenario: 超 token 上限
- **WHEN** 待注入正文累计估算超过 maxTokens
- **THEN** 按最近优先截断至限额内，剩余进入未恢复名单

#### Scenario: 全量注入零提示
- **WHEN** 候选清单 3 个文档全部注入成功
- **THEN** 无未恢复名单提示，审计日志记 ok 行（恢复成功降级为日志观测）

### Requirement: 配置开关

contextRestore SHALL 通过 settings.json 的 `shepherd.contextRestore` 子键配置（`enabled` / `maxTokens`，无限文档个数配置），走 getEffectiveConfig 三层合并，默认 `enabled: true, maxTokens: 40000`。

`/compact-config` 对 contextRestore 的操作 SHALL 采用两段式参数 `tokens` 子命令：`/compact-config tokens <N|on|off>`；旧裸数字与裸 on/off 语法不再接受。

#### Scenario: 默认启用
- **WHEN** 用户未做任何 contextRestore 配置
- **THEN** 恢复注入按默认参数生效

#### Scenario: 显式关闭回落纯提醒
- **WHEN** `shepherd.contextRestore.enabled: false`
- **THEN** 不注入，压缩提醒维持纯提醒行为

#### Scenario: /compact-config 无参查看
- **WHEN** 用户执行 `/compact-config`
- **THEN** notify 展示两块信息：contextRestore 的 enabled/maxTokens 值、当前模型自动压缩触发点（换算语义值与内部 reserveTokens 存储值），附全部用法说明

#### Scenario: /compact-config tokens 设置预算
- **WHEN** 用户执行 `/compact-config tokens 50000`
- **THEN** maxTokens 安全写入 settings.json 的 shepherd.contextRestore（沿用既有校验：1000~400000 整数），notify 确认新值

#### Scenario: /compact-config tokens 开关
- **WHEN** 用户执行 `/compact-config tokens off`（或 on）
- **THEN** enabled 写入并 notify 确认；off 后不注入，维持纯提醒

#### Scenario: 旧语法废弃提示
- **WHEN** 用户执行 `/compact-config 50000`（裸数字）或 `/compact-config on`（裸开关）
- **THEN** notify 报「未知参数」并展示两段式用法示例，配置不变

#### Scenario: /compact-config 无效值拒绝
- **WHEN** 用户执行 `/compact-config tokens abc` 或 `/compact-config abc`
- **THEN** notify 错误提示（需要正整数或 on/off），配置不变
