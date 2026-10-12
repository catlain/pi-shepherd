# Tasks: fix-rules-update-validation

- [x] 1. 提取 `VALID_CONDITION_FIELDS` 单一来源常量（含 reason），`Condition.field` 类型从常量派生（`type ConditionField = typeof VALID_CONDITION_FIELDS[number]`），rules.ts / rules-validate.ts 引用（D1）
- [x] 2. `updateRule()` 分层校验：changes 严格 + merged 存量警告（D2）
- [x] 3. bash 防绕过正则补词边界（D3，改全局 rules.json 走 shepherd_rules update——修好后这正是首个验证用例）
- [x] 4. 测试：update 含 command field 的存量规则改 reason → 成功；改非法 action → 拒绝；存量非法 + 合法 changes → 成功+警告
- [x] 5. 测试：正则 `catlain`/`node -e require` 只读命令不误拦
- [x] 6. 冒烟 + 文档：README 注明修复后需重载扩展生效（D4）
