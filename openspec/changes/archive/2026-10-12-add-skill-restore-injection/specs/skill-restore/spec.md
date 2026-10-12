## ADDED Requirements

### Requirement: 技能激活记录

shepherd SHALL 监听 `tool_execution_start` 事件（真机验证：宿主主调用路径的 `tool_call` 事件不派发到扩展层），以纯函数谓词（toolName 为 `read` 且路径以 `SKILL.md` 结尾，大小写不敏感）识别技能读取，经 existsSync 预检后（失败调用如 ENOENT 不入集）将命中路径记入会话进程内存态激活技能集；SHALL NOT 持久化激活集，SHALL NOT 对非 read 工具、非 SKILL.md 路径或不存在的文件做任何记录。

#### Scenario: read 技能文件记入激活集
- **WHEN** AI 调用 read 工具读取 `C:\...\skills\code-graph\SKILL.md`
- **THEN** 该路径记入激活技能集

#### Scenario: 非 SKILL.md 的 read 不记录
- **WHEN** AI 调用 read 工具读取任意非 SKILL.md 文件（含路径仅含 skill 字样的普通文件）
- **THEN** 不记入激活集

#### Scenario: 非 read 工具不记录
- **WHEN** AI 调用 grep / ls / write 等其他工具且参数中出现 SKILL.md 字样
- **THEN** 不记入激活集

#### Scenario: 失败调用不入集
- **WHEN** AI 调用 read 读取不存在的 SKILL.md 路径（ENOENT，正文从未进入上下文）
- **THEN** 不记入激活集（恢复无意义，且避免未恢复名单误点名）

### Requirement: 压缩后持久恢复注入

`session_compact` 事件后，若激活技能集非空且 skillRestore 启用，shepherd SHALL 调用 `sendMessage({ customType: "shepherd.skillRestore", content: 恢复正文, display: false, details }, {})`——no-triggerTurn 分支持久写入 session 树；恢复正文 SHALL 包含各技能的边界标记与完整正文；注入条目经宿主投影（custom entry → CustomMessage → user 消息）进入压缩后所有后续 provider request。SHALL NOT 调用 sendMessage(triggerTurn) 制造幽灵轮次。

#### Scenario: 注入条目结构
- **WHEN** 压缩发生且激活集含 2 个技能
- **THEN** sendMessage 以 display: false、无 triggerTurn 调用一次，content 含两个技能的边界标记与读盘正文

#### Scenario: 恢复正文进入后续请求
- **WHEN** 注入完成后用户发送下一条消息
- **THEN** 该请求的上下文含恢复条目（custom entry 投影为 user 消息），AI 无需再 read 即可见技能正文

#### Scenario: overflow 重试请求含恢复条目
- **WHEN** overflow 压缩发生且 willRetry=true
- **THEN** 恢复注入先于重试请求发出，重试请求上下文含恢复条目

#### Scenario: 无激活记录时零注入
- **WHEN** 压缩发生且激活技能集为空（本会话从未 read 过 SKILL.md）
- **THEN** 不调用 sendMessage，仅走既有提醒管线

#### Scenario: 多次压缩自愈重注
- **WHEN** 同一会话第二次压缩（上一次的恢复条目已随本次压缩摘要化挥发）
- **THEN** 激活集仍持有记录，再次注入恢复条目

#### Scenario: 子代理跳过恢复
- **WHEN** 子代理（isSubagent()=true）发生压缩
- **THEN** 不执行恢复注入（与既有提醒的子代理语义一致）

### Requirement: 大小上限保护

恢复注入 SHALL 受 maxSkills（默认 4）与 maxTokens（默认 20000）双上限约束：超出时按最近激活优先保留（激活集插入序的尾部），被截断的技能 SHALL NOT 静默丢弃，SHALL 进入提醒兜底的未恢复名单。

#### Scenario: 超技能数上限
- **WHEN** 激活集含 6 个技能且 maxSkills=4
- **THEN** 注入最近激活的 4 个，其余 2 个进入未恢复名单由提醒点名

#### Scenario: 超 token 上限
- **WHEN** 待注入正文累计估算超过 maxTokens
- **THEN** 按最近优先截断至限额内，剩余进入未恢复名单

### Requirement: 配置开关

skillRestore SHALL 通过 settings.json 的 `shepherd.skillRestore` 子键配置（`enabled` / `maxSkills` / `maxTokens`），走 getEffectiveConfig 三层合并（defaults → 全局 → 项目），默认 `enabled: true`。

#### Scenario: 默认启用
- **WHEN** 用户未做任何 skillRestore 配置
- **THEN** 恢复注入按默认参数生效

#### Scenario: 显式关闭回落纯提醒
- **WHEN** `shepherd.skillRestore.enabled: false`
- **THEN** 不记录、不注入，压缩提醒维持 0.2.0 原行为

#### Scenario: 项目级覆盖
- **WHEN** 全局 `maxSkills: 4` 且项目级 `.pi/settings.json` 声明 `maxSkills: 2`
- **THEN** 生效 maxSkills=2
