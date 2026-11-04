Affects-subsystem: uncategorized

## Context

本变更源于实证事故：给规则 39 配置 `tool_call + steer` 时，shepherd_rules 添加校验通过、运行时静默失败（tool_call 分支只消费 block/rewrite/notify）。排查发现存量 `[global:30]`、`[global:34]` 两条同为 `tool_call+steer`，早已静默失效。

**现状**（rules-validate.ts:53/66）：校验器分别校验 action ∈ VALID_ACTIONS、hook ∈ VALID_HOOKS，两者独立通过即放行——组合有效性无人负责。

**运行时支持矩阵**（全部源码实读）：

| hook | 消费的 action | 出处 |
|------|--------------|------|
| tool_call | block / rewrite / notify | tool-hooks.ts:74-88 |
| tool_result | steer / notify | tool-hooks.ts:153-163 |
| message_end | steer / notify | message-end.ts:117-119 |
| session_compact | steer | compaction.ts |
| agent_start / agent_end | steer / notify | agent-hooks.ts |

**hook 归一化**：rules.ts:168 — 缺省 hook 归一化为 `tool_call`。存量 39 条规则中 9 条无 hook 字段，实际全部按 tool_call 运行。

**约束**：运行时全局规则文件即本仓库 `rules.json`（git 包安装指向源码目录），存量修复需通过 shepherd_rules 工具完成并随仓库发布。

## Goals / Non-Goals

**Goals:**

- 无效组合在写入时（add / update 的 changes 路径）被拒绝，报错附支持矩阵指引
- 支持矩阵单一来源，校验器与运行时真相同源，杜绝「校验通过但永不生效」
- 运行时兜底可观测：tool_call 分支遇到 steer 等未消费 action 时输出警告，不再完全静默
- 修复存量 2 条静默失效规则（`[global:30]`、`[global:34]`）

**Non-Goals:**

- 不新增 hook 对 action 的支持（如让 tool_call 支持 steer）——那是行为扩展，本变更只治「静默」
- 不做规则文件 schema 迁移（无字段增删）
- 不做矩阵与运行时分支的全自动一致性测试（见 Open Questions）

## Decisions

### D1. 支持矩阵作为导出常量放 rules.ts，单一来源（WHY: 校验矩阵与运行时分支是同一事实的两份描述，人工维护必然漂移——本次事故即「描述缺失」型漂移；与 10-12 D1 合法值双清单同根因）

- **Type**: layering-principle
- **Sediment-to**: ADR（校验器与运行时共享的真相必须单一来源，成员常量放 rules.ts）

### D2. 组合校验挂在归一化后的 hook 上（缺省 = tool_call）（WHY: 存量 9 条无 hook 规则实际按 tool_call 运行；若按原始字段校验，`{action:"steer"}` 无 hook 的新规则仍会静默失效——校验必须基于运行时行为模型而非配置原始形状）

- **Type**: layering-principle
- **Sediment-to**: ADR（校验模型与运行时归一化保持同构）

### D3. update 分层校验扩展到组合维度（WHY: 存量 2 条无效组合若被连坐拒绝，重演 8-31「存量规则永久锁死」事故；仅在 changes 触及 hook/action 字段时严格校验，未触及则降级警告）

- **Type**: layering-principle
- **Sediment-to**: ADR（复用 10-12 D2 分层原则，扩展至组合维度）

### D4. 运行时对未消费 action 输出警告而非拦截（WHY: 校验器挡住工具写入路径已覆盖主场景；外部直接改 rules.json 的绕过路径由运行时警告兜底进 restore-log，可观测但不破坏加载——拦截加载会让一条坏规则拖垮整个 shepherd）

- **Type**: one-off
- **Sediment-to**: none

### D5. 存量修复 steer→notify 而非删除（WHY: `[global:30]` 验证提醒、`[global:34]` 查询引导在 tool_call 上 notify 是语义最近的合法形态；删除规则丢失防护意图，静默失效已证明其存在必要性被用户认可过）

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [矩阵与运行时分支未来再次漂移（新增 hook/扩展 action 时）] → 矩阵每项注释源码出处；矩阵未收录的 hook 一律拒绝并提示「先更新矩阵」——开发期错误优先暴露，不留静默通道
- [steer→notify 提醒力度下降（notify 不进 steering 队列，仅提示）] → 存量修复后逐条实测提醒可见；力度不足再单独评估（属 Non-Goal 的行为扩展）
- [组合校验误伤「语义上有效但矩阵没写」的边缘组合] → 矩阵以源码分支实读为准逐项核对；发现漏项先改矩阵再放行，校验器不设白名单后门

## Migration Plan

1. 合入矩阵常量 + 校验器改动 + 运行时警告 + 测试，发版
2. 通过 shepherd_rules 工具修复 `[global:30]`、`[global:34]`（action → notify），随 rules.json 入库
3. 观察 restore-log 一轮，确认无新警告噪声
- 回滚：恢复上一版包即可；rules.json 无 schema 变化，规则修复项独立可回退

## Open Questions

- 是否值得做「矩阵 × 分支」一致性测试（对每个矩阵项断言对应 hook 处理器存在消费分支）？收益是漂移防线自动化，成本是 mock 各 hook 事件的测试脚手架。倾向先不做（矩阵注释 + 校验器已覆盖主风险），列入 tasks 可选项。
