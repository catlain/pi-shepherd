# rules-tool Validation Requirements

## ADDED Requirements

### Requirement: 条件 field 合法值单一来源

校验器与匹配引擎的 `conditions[].field` 合法值列表 SHALL 由同一导出常量提供，且 SHALL 包含 `command`。

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
