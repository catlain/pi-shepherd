## ADDED Requirements

### Requirement: hook×action 组合校验

shepherd_rules 的写入路径（add / update 的 changes）MUST 校验 hook 与 action 的组合有效性：hook 按 rules.ts 的归一化规则解析（缺省 = tool_call）后，action MUST 在该 hook 的支持矩阵内。支持矩阵 MUST 以单一来源常量维护（rules.ts 导出），校验器与运行时警告 MUST 消费同一常量，禁止两处各写一份清单。

支持矩阵（初始值，以源码消费分支为准）：

| hook | 支持的 action |
|------|--------------|
| tool_call | block, rewrite, notify |
| tool_result | steer, notify |
| message_end | steer, notify |
| session_compact | steer |
| agent_start | steer, notify |
| agent_end | steer, notify |

矩阵未收录的 hook MUST 拒绝写入并提示「先更新矩阵常量」，不得静默放行。

#### Scenario: add 无效组合被拒绝

- **WHEN** 调用 shepherd_rules add 传入 `{hook: "tool_call", action: "steer"}`
- **THEN** 写入被拒绝，报错说明 tool_call 仅支持 block/rewrite/notify

#### Scenario: hook 缺省按归一化后 hook 校验

- **WHEN** 调用 add 传入 `{action: "steer"}`（未指定 hook）
- **THEN** 按 hook 归一化为 tool_call 后校验组合，同样拒绝

#### Scenario: update 触及 action 且结果组合无效被拒绝

- **WHEN** 对 hook 为 tool_call 的规则执行 `update changes={action: "steer"}`
- **THEN** 拒绝更新，报错附支持矩阵指引

#### Scenario: update 未触及 hook/action 的存量无效组合不锁死

- **WHEN** 对存量 `tool_call + steer` 规则执行 `update changes={enabled: false}`（不触及组合字段）
- **THEN** 更新放行，并在返回中附降级警告提示该规则组合无效

#### Scenario: 矩阵未收录的 hook 被拒绝

- **WHEN** add 传入矩阵中不存在的 hook 值
- **THEN** 拒绝写入并提示需先更新矩阵常量

### Requirement: 运行时无效组合警告

各 hook 处理器遇到其消费分支不支持的 action 时 MUST 输出可见警告（进入 restore-log 或等价日志通道），MUST NOT 拦截整个规则文件加载，MUST NOT 影响其他规则的正常执行。

#### Scenario: tool_call 分支遇到 steer

- **WHEN** 一条 hook=tool_call、action=steer 的规则被 tool_call 事件加载执行
- **THEN** 输出「该组合无消费分支」警告到日志，该规则跳过执行，其余规则不受影响
