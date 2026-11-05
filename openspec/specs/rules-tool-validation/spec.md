# rules-tool-validation Specification

## Purpose

约束 shepherd_rules 工具对规则文件的校验与更新行为：合法值清单单一来源（杜绝校验器/匹配器/类型三方漂移）、update 分层校验（存量规则不被历史遗留字段永久锁死）、防绕过正则不误伤只读命令（安全网不把 AI 逼向裸改）。

本 capability 的五个 requirement 分别源于实证事故：合法值双清单漂移（8-31 command 分叉锁死 update、10-10 reason 手动双改）、连坐校验（8-31 事故）、catlain 子串误拦（8-31 与 10-12 两次），以及 2026-11 的 tool_call+steer 组合静默失效（规则 39 事故 + 存量 30/34 两条 + 工具名漂移 33）——组合维度由 HOOK_ACTION_SUPPORT 矩阵单一来源治理。

## Requirements

### Requirement: 条件 field 合法值单一来源

校验器与匹配引擎的 `conditions[].field` 合法值列表 SHALL 由同一导出常量提供，`Condition.field` 类型 SHALL 从该常量派生（新增合法值时类型/校验/文案单点联动），合法值 SHALL 包含 `command` 与 `reason`。

#### Scenario: 存量 command field 通过校验

- **WHEN** 校验或 update 一条 `conditions[].field` 为 `"command"` 的规则
- **THEN** 不因 field 值报错

### Requirement: update 分层校验

`updateRule()` SHALL 对 `changes` 中出现的字段严格校验（非法即拒绝）；对合并后规则中 changes 未触及的存量字段 SHALL 降级为警告，不得因此拒绝写入。

#### Scenario: 更新无关字段不再连坐

- **WHEN** 存量规则含历史遗留的不合法字段，update 仅修改 `reason`
- **THEN** 写入成功，返回文本附存量字段警告与修复指引

#### Scenario: 非法 changes 仍被拒绝

- **WHEN** update 传入 `changes={action: "disable"}`（非法 action）
- **THEN** 拒绝写入，报错并提示正确做法

### Requirement: 防绕过正则不误伤只读命令

bash 防绕过规则中的裸词（`cat`、`write`）SHALL 使用词边界，避免路径/子串误伤（如 `github.com/catlain`）。

#### Scenario: 只读 node 查询不误拦

- **WHEN** bash 执行 `node -e "require('./rules.json')..."` 或命令文本含 `catlain`
- **THEN** 不被防绕过规则 block

### Requirement: hook×action 组合校验

shepherd_rules 工具的校验器 SHALL 校验规则归一化后（hook 缺省 = `tool_call`，action 缺省 = `block`）的 hook×action 组合在支持矩阵 `HOOK_ACTION_SUPPORT`（rules.ts 导出，与运行时消费分支单一来源）内；矩阵未收录的 hook SHALL 拒绝；报错信息 SHALL 附该 hook 支持的 action 列表；`update` SHALL 分层——changes 触及 hook/action 字段时严格校验合并后组合，未触及则降级警告放行。

#### Scenario: add 无效组合被拒绝

- **WHEN** add 一条 `hook=tool_call + action=steer` 的规则
- **THEN** 拒绝写入，报错附 `tool_call 仅支持 block / rewrite / notify` 指引

#### Scenario: hook 缺省按归一化后校验

- **WHEN** add 一条仅 `{action: "steer"}`（无 hook 字段）的规则
- **THEN** 按 `tool_call` 归一化后校验组合，被拒绝

#### Scenario: update 触及 action 且产生无效组合被拒绝

- **WHEN** update 一条 tool_call 规则，`changes={action: "steer"}`
- **THEN** 拒绝写入并提示支持的 action

#### Scenario: update 未触及组合维度的存量无效组合不锁死

- **WHEN** update 一条存量 `tool_call+steer` 规则，`changes={enabled: false}`
- **THEN** 写入成功，附组合无效降级警告

#### Scenario: 矩阵未收录的 hook 被拒绝

- **WHEN** add 一条 hook 为矩阵未收录值的规则
- **THEN** 拒绝，提示先在 rules.ts 更新 HOOK_ACTION_SUPPORT 矩阵

### Requirement: 运行时无效组合警告

规则加载出口（compileRules）SHALL 对归一化后组合无效的规则输出警告（去重后进 stderr/restore-log），SHALL NOT 拒绝加载或阻塞其余规则执行。

#### Scenario: 无效组合输出警告且不阻塞加载

- **WHEN** 规则文件含一条 `tool_call+steer` 规则（外部手改绕过校验器）
- **THEN** 加载时输出一条「组合无效，规则静默失效」警告，其余规则照常编译生效
