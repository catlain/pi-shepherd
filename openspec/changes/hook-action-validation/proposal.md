# hook×action 组合校验

## Why

给规则 39（bash grep -r 引导）配置 `tool_call + steer` 时，shepherd_rules 添加校验通过、运行时静默失败——tool-hooks.ts 的 tool_call 分支只处理 block/rewrite/notify，steer 无分支接住也无任何报错。排查存量发现 `[global:30]`（Rust 编译验证提醒）、`[global:34]`（ro_query 引导）两条同为 `tool_call+steer`，早已静默失效。校验器目前只校验 action/hook 各自的合法值（rules-validate.ts:53/66），不校验组合有效性。「添加成功但永不生效」是配置型系统最隐蔽的失败模式，用户若不实测根本发现不了。

## What Changes

- 新增支持矩阵导出常量（hook → 该 hook 实际消费的 action 列表），与 VALID_CONDITION_FIELDS 同层、单一来源
- 校验器在组合维度校验：hook 按 rules.ts:168 的归一化规则（缺省 = tool_call）解析后，action 必须在支持矩阵内
- update 路径遵循分层校验：`changes` 触及 hook/action 时严格校验拒绝；未触及的存量无效组合降级为警告（不得锁死 update，防 8-31 连坐事故重演）
- tool_call 运行时分支遇 steer 时输出可见警告（日志/restore-log），不再完全静默
- 修复存量：`[global:30]`、`[global:34]` 修正 action 为 notify（tool_call 支持的注入形态）
- rules-tool 的 list 输出对无效组合规则加标记（如 ⚠️）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `rules-tool-validation`: 新增「hook×action 组合校验」requirement——支持矩阵单一来源、add 严格拒绝无效组合、update 分层校验不锁死存量、运行时不再静默。

## Impact

- `shepherd/rules.ts` — 支持矩阵常量 + 归一化逻辑复用
- `shepherd/rules-validate.ts` — 组合校验规则
- `shepherd/rules-tool.ts` / `rules-tool-helpers.ts` — update 分层路径、list 标记
- `shepherd/tool-hooks.ts` — tool_call+steer 运行时警告（轻量）
- `tests/` — 校验器与 update 分层的新用例
- 运行时 `rules.json` — 修复 2 条存量无效规则
- 无破坏性变更：现有合法组合行为完全不变；仅无效组合从「静默失败」变为「写入时拒绝 + 运行时可见」
