## 1. 支持矩阵单一来源

- [ ] 1.1 rules.ts 新增导出 `HOOK_ACTION_SUPPORT` 矩阵常量：hook → 消费的 action 数组，逐项注释源码出处（tool_call→tool-hooks.ts:74-88、tool_result→tool-hooks.ts:153-163、message_end→message-end.ts:117-119、session_compact→compaction.ts、agent_start/agent_end→agent-hooks.ts）
- [ ] 1.2 rules.ts 抽出并导出 `normalizeHook(rule)`（缺省 = tool_call），rules.ts:168 的加载归一化改为调用该函数（运行时与校验同源）

## 2. 校验器组合校验

- [ ] 2.1 rules-validate.ts 的 validateRule 增加组合校验：`normalizeHook` 解析 hook 后 action 必须在 `HOOK_ACTION_SUPPORT` 内；矩阵未收录的 hook 拒绝并提示「先更新矩阵常量」
- [ ] 2.2 update 的 changes 路径分层：changes 触及 hook/action 字段时合并结果后严格校验拒绝；未触及组合字段的存量无效组合放行并在返回中附降级警告
- [ ] 2.3 报错文案附矩阵指引（如「tool_call 仅支持 block/rewrite/notify」）

## 3. 运行时警告

- [ ] 3.1 新增 `warnUnsupportedAction(rule, hookName)` helper，输出到 restore-log（或现有日志通道）
- [ ] 3.2 tool-hooks.ts 的 tool_call 分支接入 helper：遇未消费 action（如 steer）警告并跳过该规则，不影响其余规则执行
- [ ] 3.3 tool-result/message-end/compaction/agent-hooks 分支同样接入 helper 兜底

## 4. 测试

- [ ] 4.1 单测：`HOOK_ACTION_SUPPORT` 完整性——VALID_HOOKS 每个成员都在矩阵中
- [ ] 4.2 单测：validateRule 组合校验（add 无效组合拒绝 / hook 缺省归一化后拒绝 / 矩阵未收录 hook 拒绝 / 全部合法组合放行）
- [ ] 4.3 单测：update 分层（changes={action:"steer"} 到 tool_call 规则被拒 / changes={enabled:false} 到存量无效组合放行+警告）
- [ ] 4.4 单测：tool_call 运行时警告（遇 steer 不抛错、后续规则照常执行）

## 5. 存量修复与发版

- [ ] 5.1 shepherd_rules 工具修复 `[global:30]`、`[global:34]`：action steer → notify
- [ ] 5.2 实测修复效果：触发一次对应场景验证提醒可见（30=编译产物验证、34=ro_query 引导）
- [ ] 5.3 更新 README 规则 schema 说明：hook×action 支持矩阵与组合校验行为
- [ ] 5.4 `npm run typecheck` + `npm test` 全绿
- [ ] 5.5 按 npm-publish 技能流程发版（含 rules.json 存量修复入库）
