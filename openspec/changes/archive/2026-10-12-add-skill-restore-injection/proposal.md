## Why

0.2.0 的 compact-skill-reminder 是软信号：压缩后注入一条 ephemeral 提醒，依赖 AI 自觉去重读 SKILL.md——实测 AI 可能不反应，技能正文（程序性操作指引）就此丢失。摘要擅长保留"发生了什么"，不擅长保留"怎么操作"；需要一个硬恢复通道：压缩后把激活过的技能正文**持久注入**回上下文，零依赖 AI 配合。

## What Changes

- 新增技能记录器：shepherd 监听 `tool_result` 事件，read 调用路径匹配 SKILL.md 时（纯函数谓词，可单测）记入会话内存态"激活技能集"
- 新增持久恢复注入：`session_compact` 回调读取激活技能集，用 `sendMessage({ customType, content: 技能正文, display: false }, {})`（no-trigger 分支）经 `appendCustomMessageEntry` 持久写入会话树——custom entry 投影为 CustomMessage，`convertToLlm` 原样转 user 消息进入后续所有请求，无幽灵轮次（维持 D1 原则）
- 提醒降级联动：注入成功时 compact-skill-reminder 提醒降级（正文已恢复，无需再引导重读）；无激活记录或注入失败时提醒兜底
- 大小上限保护：多技能注入时按策略截断，防止恢复条目膨胀
- settings 开关：`shepherd.skillRestore` 独立子键，走 `getEffectiveConfig` 三层合并（全局 → 项目），默认启用

## Capabilities

### New Capabilities

- `skill-restore`: 压缩后技能正文持久恢复——记录器（tool_result 监听 + SKILL.md 谓词）、注入管线（session_compact → sendMessage 持久 entry）、大小上限保护、settings 开关

### Modified Capabilities

- `compaction-reminder`: 提醒触发行为变化——skill-restore 注入成功时提醒降级为兜底信号（不再无条件引导重读），注入未覆盖时维持原行为

## Impact

- **代码**：新增 `shepherd/skill-restore.ts`（记录器 + 注入决策，两职责分离）；`shepherd/compaction.ts` 增加联动（注入结果影响提醒）；`index.ts` 事件注册；barrel 导出
- **配置**：`settings.json` 新增 `shepherd.skillRestore` 子键（enabled / 上限参数）
- **规则**：rules.json 默认规则 `global:36` 语义不变，规则引擎零改动（恢复注入是框架内建行为，独立模块旁挂，与 state-tracker / ephemeral hint 先例一致）
- **正交声明**：与存量 change `fix-rules-update-validation`（rules.ts / rules-validate.ts / rules.json / README）文件级零重叠，可并行
- **运行时依赖**：`session_compact` 事件、`sendMessage` API、`appendCustomMessageEntry` 投影链——宿主 0.78+ 已支持（已在 pi 1.1.0 源码验证全链路）
