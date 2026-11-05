Affects-subsystem: uncategorized

## Context

本变更源于实证事故：给规则 39 配置 `tool_call + steer` 时，shepherd_rules 添加校验通过、运行时静默失败（tool_call 分支只消费 block/rewrite/notify）。随后对 40 条存量规则做四维普查（组合矩阵/工具名存活/正则可编译/停用状态），确认 **3 条静默失效，分属三种形态**：

| 规则 | 失效形态 | 定因 | 处置 |
|------|---------|------|------|
| 30 Rust pyd 验证 | tool_call+steer 组合无效 | 规则写错（组合），场景仍有效（maturin 工作流在用） | 修组合 |
| 33 module_overview 空结果 | 工具名漂移：`code_graph_module_overview` vs 实际 `mcp__code_graph__module_overview`（toolMatches 纯精确匹配，rules.ts:385，无通配无后缀） | 规则写错（工具名过时），工具本身活跃 | 修工具名 |
| 34 ro_query 引导 | tool_call+steer 组合无效 | 规则写错（组合）；ro_query 活跃（`D:\Project\Quant\quant-base\scripts\ro_query.py`，近期会话高频调用）——**非工具退休** | 修组合 |
| 4 / 5 | enabled=false 显式停用，注释写明去向 | 健康弃用先例 | 不处理 |

正则可编译性全量扫描通过（40/40）；无一条命中「工具退休需弃用」。

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
- 修复存量 3 条静默失效规则（30/34 组合、33 工具名，按普查定因逐条）
- 同步 shepherd-usage SKILL.md 与 pi-shepherd README（矩阵/陷阱/工具名规范），文档承诺与实现对齐

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

### D5. 存量修复按定因逐条执行，非盲目改字段（WHY: 失效原因决定处置——若工具真退休，改组合是复活僵尸；普查定因后逐条：30 组合错→action steer→notify；33 工具名漂移→tool 加 mcp__code_graph__ 前缀；34 组合错→action steer→notify。ro_query 经实证活跃（D 盘项目高频调用），非退休不删。每条修复后探针实测提醒可见：30=cargo build 触发、33=module_overview 空路径触发、34=DataStore() 内联触发）

- **Type**: one-off
- **Sediment-to**: none

### D6. 技能与文档同步是变更的必经部分（WHY: SKILL.md 第 52 行已承诺「写入前自动校验（含 hook 组合合法性）」——变更落地前这是虚假承诺；陷阱 1 教用户用 `node -e` 验证正则，会被规则 36 拦截，自相矛盾。修工具不同步文档，下一个写规则的人仍踩同样的坑。同步清单：① Schema 速查表补 hook×action 矩阵；② 新增「工具名漂移」陷阱（MCP 工具必须用 mcp__server__tool 全名）；③ 陷阱 1 示例 node -e → codemode；④ 管理规则区说明组合校验与报错指引；README.md 同步矩阵与 MCP 工具名规范）

- **Type**: one-off
- **Sediment-to**: none

### D7. 弃用记录文档作兜底机制，当前无条目（WHY: 实施中若发现确凿失效但无法定因、需用户判断的规则，保留原貌存证而非硬修/硬删，避免误杀有暗依赖的规则；机制：全文复制到 changes/hook-action-validation/retired-rules.md 附怀疑原因与证据 → 从 rules.json 删除防校验连坐 → 最终报告列出待定夺。普查已覆盖四维度，当前无此类条目，机制作为实施期兜底流程写入 tasks）

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [矩阵与运行时分支未来再次漂移（新增 hook/扩展 action 时）] → 矩阵每项注释源码出处；矩阵未收录的 hook 一律拒绝并提示「先更新矩阵」——开发期错误优先暴露，不留静默通道
- [steer→notify 提醒力度下降（notify 不进 steering 队列，仅提示）] → 存量修复后逐条实测提醒可见；力度不足再单独评估（属 Non-Goal 的行为扩展）
- [33 修复后 MCP 前缀再变（server 改名）] → toolMatches 加后缀匹配属行为扩展，超出本变更（Open Questions 记录）；当前用全名精确匹配
- [技能文档与实现再次脱节] → D6 同步与代码改动同变更交付；后续规则 schema 变更时 README/SKILL 同步纳入 tasks 惯例
- [组合校验误伤「语义上有效但矩阵没写」的边缘组合] → 矩阵以源码分支实读为准逐项核对；发现漏项先改矩阵再放行，校验器不设白名单后门

## Migration Plan

1. 合入矩阵常量 + 校验器改动 + 运行时警告 + 测试，发版
2. 通过 shepherd_rules 工具修复存量 3 条（30/34 组合、33 工具名），逐条探针验证，随 rules.json 入库
3. 同步 SKILL.md 与 README（D6 清单）
4. 观察 restore-log 一轮，确认无新警告噪声
- 回滚：恢复上一版包即可；rules.json 无 schema 变化，规则修复项独立可回退

## Open Questions

- 是否值得做「矩阵 × 分支」一致性测试（对每个矩阵项断言对应 hook 处理器存在消费分支）？收益是漂移防线自动化，成本是 mock 各 hook 事件的测试脚手架。倾向先不做（矩阵注释 + 校验器已覆盖主风险），列入 tasks 可选项。
- toolMatches 通配/后缀匹配：[33] 事故暴露工具名漂移脆弱性，后缀匹配可免疫前缀变化，但改变匹配语义（可能误匹配同名工具）——若未来再发生同类事故再议。
