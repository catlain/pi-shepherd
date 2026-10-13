# context-restore Delta Spec（ADDED）

## ADDED Requirements

### Requirement: 上下文激活记录

shepherd SHALL 监听 `tool_execution_start` 事件，以纯函数谓词识别上下文文档读取——命中条件为以下之一：路径以 `SKILL.md` 结尾（大小写不敏感），或规范化路径含 `openspec/` 路径段且以 `.md` 结尾。命中路径经 existsSync 预检（失败调用如 ENOENT 不入集）后记入会话进程内存态激活集（技能与文档共池、Set 重读移尾）；SHALL NOT 持久化激活集，SHALL NOT 记录非 read 工具、双条件均不满足的路径或不存在的文件。

#### Scenario: read openspec design.md 记入激活集
- **WHEN** AI 调用 read 读取 `.../pi-shepherd/openspec/changes/foo/design.md`
- **THEN** 该路径记入激活集

#### Scenario: read 主 spec 记入激活集
- **WHEN** AI 调用 read 读取 `.../openspec/specs/context-restore/spec.md`
- **THEN** 该路径记入激活集

#### Scenario: 技能与文档共池单序
- **WHEN** AI 依次 read SKILL-A、design.md、SKILL-B
- **THEN** 激活集插入序为 [SKILL-A, design.md, SKILL-B]，预算与截断在共池上计算

#### Scenario: 非 openspec 的普通 .md 不记录
- **WHEN** AI 调用 read 读取 `docs/agent/ADR.md` 或 `README.md`
- **THEN** 不记入激活集（第一版明确收窄）

#### Scenario: 失败调用不入集
- **WHEN** AI 调用 read 读取不存在的 openspec 文档路径（ENOENT）
- **THEN** 不记入激活集（existsSync 预检）

### Requirement: 压缩后持久恢复注入

`session_compact` 事件后，若激活集非空且 contextRestore 启用，shepherd SHALL 调用 `sendMessage({ customType: "shepherd.contextRestore", content: 恢复正文, display: false }, {})` 持久写入 session 树（no-triggerTurn）；恢复正文含各文档的边界标记（`上下文恢复: <basename> (<path>)`）与完整正文；注入条目经宿主投影进入压缩后所有后续 provider request。SHALL NOT 调用 sendMessage(triggerTurn)。

#### Scenario: 注入条目结构
- **WHEN** 压缩发生且激活集含 1 个 SKILL.md + 2 个 openspec 文档
- **THEN** sendMessage 以 display:false、无 triggerTurn 调用一次，content 含三个条目的边界标记与读盘正文

#### Scenario: 无激活记录时零注入
- **WHEN** 压缩发生且激活集为空
- **THEN** 不调用 sendMessage，仅走既有提醒管线

#### Scenario: 多次压缩自愈重注
- **WHEN** 同一会话第二次压缩（上次恢复条目已随压缩挥发）
- **THEN** 激活集仍持有记录，再次注入恢复条目

#### Scenario: 子代理跳过恢复
- **WHEN** 子代理（isSubagent()=true）发生压缩
- **THEN** 不执行恢复注入

### Requirement: token 预算保护与截断点名

恢复注入 SHALL 仅受 maxTokens（默认 40000）预算约束（不限文档个数）：超出时按激活集插入序尾部（最近激活）优先保留，被截断文档 SHALL NOT 静默丢弃，SHALL 进入未恢复名单由提醒文本点名；全量注入时 SHALL 零提示。

#### Scenario: 超 token 上限
- **WHEN** 待注入正文累计估算超过 maxTokens
- **THEN** 按最近优先截断至限额内，剩余进入未恢复名单

#### Scenario: 全量注入零提示
- **WHEN** 激活集 3 个文档全部注入成功
- **THEN** 无未恢复名单提示（提醒降级为 ui.notify 轻提示）

### Requirement: 配置开关

contextRestore SHALL 通过 settings.json 的 `shepherd.contextRestore` 子键配置（`enabled` / `maxTokens`，无限文档个数配置），走 getEffectiveConfig 三层合并，默认 `enabled: true, maxTokens: 40000`。

#### Scenario: 默认启用
- **WHEN** 用户未做任何 contextRestore 配置
- **THEN** 恢复注入按默认参数生效

#### Scenario: 显式关闭回落纯提醒
- **WHEN** `shepherd.contextRestore.enabled: false`
- **THEN** 不记录、不注入，压缩提醒维持纯提醒行为

#### Scenario: /compact-config 无参查看
- **WHEN** 用户执行 `/compact-config`
- **THEN** notify 展示当前 enabled/maxTokens 值与用法说明

#### Scenario: /compact-config 设置预算
- **WHEN** 用户执行 `/compact-config 50000`（裸数字设 maxTokens）
- **THEN** 对应字段安全写入 settings.json 的 shepherd.contextRestore，notify 确认新值

#### Scenario: /compact-config 开关
- **WHEN** 用户执行 `/compact-config off`（或 on）
- **THEN** enabled 写入并 notify 确认；off 后不记录不注入，维持纯提醒

#### Scenario: /compact-config 无效值拒绝
- **WHEN** 用户执行 `/compact-config abc`
- **THEN** notify 错误提示（需要正整数），配置不变
