Affects-subsystem: uncategorized

## Context

pi 宿主（1.1.0）压缩链路五环已在本会话逐环源码验证（`agent-session.js` / `messages.js` / `session-manager.js`）：

```
① sendCustomMessage(message, options) JSDoc 第四分支：not streaming + no triggerTurn
   → _appendCustomMessage()
② appendCustomMessageEntry(customType, content, display, details) → session 树持久化
③ 投影：session-manager.js L181 createCustomMessage(entry.customType, ...) → CustomMessage
④ convertToLlm case "custom"（messages.js L92-98）→ { role: "user", content: 原样 } 零过滤
⑤ CustomMessage.display: false → TUI 不显示；无 triggerTurn → 无幽灵轮次
```

现状：0.2.0（change add-compaction-reminder）已交付 `hook: "session_compact"` 规则 + ephemeral 提醒管线，三场景（manual/threshold/overflow）验证闭环。但提醒是软信号——实测 AI 可能不反应；摘要保留"发生了什么"却不保留"怎么操作"，技能正文一旦挥发，引导重读的依赖链就断在 AI 的自觉性上。

上 change 的 D5 曾否决"清单记账"（StateTracker + resume 失忆问题，复杂度不配）。本次翻转的依据：收益端从"点名提醒"升级为"正文持久恢复"（注入 entry 在压缩后所有请求里常驻），复杂度端几乎不变（一个纯函数谓词 + 一个 Set），投入产出比反转；resume 失忆仍存在，接受为已知限制、由提醒兜底。

维护者协调结论（intercom 存档）：与存量 change `fix-rules-update-validation`（rules.ts / rules-validate.ts / rules.json / README）文件级零重叠，可并行；独立监听获架构背书（内建行为不进规则引擎，先例：state-tracker、ephemeral hint）；附三条设计建议（纯函数谓词、settings 子键、职责分离）均已吸收。

## Goals / Non-Goals

**Goals:**

- 压缩后激活过的 SKILL.md 正文自动持久恢复（custom entry），零依赖 AI 配合、零用户感知（display: false）
- 恢复注入与现有提醒管线联动：注入成功时提醒降级，未覆盖时提醒兜底
- 配置可控：`shepherd.skillRestore` 子键（enabled / maxSkills / maxTokens），三层合并，默认启用
- 框架内建行为：独立模块旁挂 index.ts，规则引擎零改动

**Non-Goals:**

- 摘要定制或接管压缩流程（`session_before_compact` 的 result.compaction 通道）——仍是 pi-smart-compact 领地，且扩展抛错会炸掉压缩本身
- resume 跨会话持久：记录器是会话进程内存态，重启丢记录（已知限制，提醒兜底）
- 非 SKILL.md 内容恢复（任意文件/网页正文不在范围）
- 技能正文版本 diff（注入压缩时读盘的最新版即可）

## Decisions

### D1 注入通道：sendMessage no-trigger 持久 entry

`session_compact` 回调里 `pi.sendMessage({ customType: "shepherd.skillRestore", content, display: false, details }, {})`。依据：五环验证链全通（见 Context）；对比 ephemeral hint（一次性、软信号）和 result.compaction 硬合体（要复刻摘要流程、扩展失败炸压缩），“持久 entry + 不动压缩流程”是唯一同时满足持久性、低风险、零幽灵轮次的通道。overflow 场景天然工作：`session_compact` 事件先于 willRetry 重试请求，注入 entry 落在重试请求上下文里。

- **Type**: one-off
- **Sediment-to**: none

### D2 技能来源：tool_execution_start 自动记录，会话内存态

记录器监听 `tool_execution_start`：read 调用的 `args.path` 匹配 SKILL.md（谓词见 D4。真机验证事实修正：宿主主调用路径的 `tool_call` 事件实测未派发到扩展层（enabled 的 tool_call 规则从未触发），而 `tool_execution_start` 是 UI 执行动画数据源、每次工具执行必发且携带 {toolName, args}；代价=失败调用也发事件，以 existsSync 预检过滤——正文从未进上下文的不入激活集）→ Set 记路径。压缩回调读 Set → 磁盘读正文 → 注入。生命周期=会话进程：跨压缩持续有效（多次压缩重复注入自愈——旧恢复 entry 下次压缩又被摘要挥发，Set 仍持有激活集，再注入即可）。**实现期陷阱（重要）：jiti 对 `"./skill-restore"` 与 `"./skill-restore.js"` 两种 import 说明符产生双 cache key = 双模块实例，模块级 Set 状态分裂（handler 写 A 实例、restore 读 B 实例 → 激活集恒空）。库内 import 说明符必须统一为无扩展名风格（barrel 已是此风格）。**备选（branchEntries 扫描：更准但需解析 entry 结构、且 handler 拿到的 branchEntries 在 session_compact 事件里不可得）与（配置清单：死板、要维护）均被否。

- **Type**: one-off
- **Sediment-to**: none

### D3 架构归属：独立模块旁挂，不进规则引擎

恢复注入是框架内建行为（记录→恢复），不是用户可配置策略——塞进规则引擎会污染规则列表（用户看到删不掉的系统规则）。维护者裁定支持：先例一致（state-tracker、ephemeral hint 都是独立模块旁挂 index.ts），性能面独立谓词还避免给规则引擎全量匹配加负担。规则引擎、rules.json、rules-validate 零改动。

- **Type**: layering-principle
- **Sediment-to**: ADR

### D4 过滤谓词纯函数 + 记录/注入职责分离

谓词 `isSkillRead(toolName, args)`：toolName === "read" 且 path 以 SKILL.md 结尾（大小写不敏感），纯函数可单测。记录器只写模块态（Set.add），注入决策（读态、读盘、上限、sendMessage）全部留在 session_compact 回调——两职责分离，与状态追踪先例一致。

- **Type**: one-off
- **Sediment-to**: none

### D5 配置：shepherd.skillRestore 子键，三层合并

`{ enabled: true, maxSkills: 4, maxTokens: 20000 }`，走 `getEffectiveConfig("shepherd", defaults, cwd)` 与 shepherd 既有接入方式一致。默认启用：零配置受益，行为透明（注入静默 + ui.notify 轻提示），可整体关闭回落到纯提醒。

- **Type**: one-off
- **Sediment-to**: none

### D6 提醒联动：注入成功时降级，未覆盖时兜底

注入成功（≥1 技能正文注入）→ 跳过 `global:36` 的"请重读"steer 文本，改为 ui.notify 轻提示（"已恢复技能: a, b, c"）；激活集为空 / 注入失败 / 超上限截断 → 维持原提醒（超上限时提醒文本点名未恢复的技能路径）。规则引擎不感知此联动（global:36 语义不变，联动在 compaction.ts handler 层实现）——compaction-reminder spec 的 Requirement 增补此降级行为。

- **Type**: one-off
- **Sediment-to**: none

### D7 大小上限：技能数与 token 双闸，超限截断降级

maxSkills（默认 4，按最近激活优先保留——Set 保插入序，取尾部最近）与 maxTokens（默认 20000，估算正文 token 累计）双上限。超限：注入不整体失败，截断保留最近的，其余降级进提醒点名（与 D6 兜底共用）。恢复条目膨胀的根源（多次压缩累积）由 maxTokens 自然封顶。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [custom entry 渲染语义随宿主升级漂移] → 单测锁定 sendMessage 调用形态（customType/display/content 结构）；pi 升级时跑回归
- [overflow 时序] session_compact 与 willRetry 重试请求的先后依赖宿主实现顺序（当前源码：压缩完成 emit 后才 continue）→ 单测 mock 验证注入先于重试请求；升级时关注 agent-session 变更
- [tool_call 高频调用谓词开销] → 纯函数 O(1) 字符串判断，无 IO；维护者性能面确认无异议
- [注入 entry 与提醒 hint 双通道竞争] → D6 联动：注入成功即抑制 steer 文本，二者互斥
- [skillRestore.enabled: true 的默认行为变化] → 现有用户升级后压缩时多一条不可见 entry + notify 轻提示；proposal/README 明示，可一键关
- [磁盘上 SKILL.md 被删/改] → 读盘失败跳过该技能（记入未恢复名单，走提醒兜底）；读到的是压缩时最新版，非 read 时的快照（Non-Goal 已声明）
