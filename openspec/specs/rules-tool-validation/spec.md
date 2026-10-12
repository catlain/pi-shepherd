# rules-tool-validation Specification

## Purpose

约束 shepherd_rules 工具对规则文件的校验与更新行为：合法值清单单一来源（杜绝校验器/匹配器/类型三方漂移）、update 分层校验（存量规则不被历史遗留字段永久锁死）、防绕过正则不误伤只读命令（安全网不把 AI 逼向裸改）。

本 capability 的三个 requirement 分别源于实证事故：合法值双清单漂移（8-31 command 分叉锁死 update、10-10 reason 手动双改）、连坐校验（8-31 事故）、catlain 子串误拦（8-31 与 10-12 两次）。

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
