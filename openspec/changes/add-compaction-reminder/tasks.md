## 1. 规则系统类型与校验扩展（三处同步，防分叉）

- [x] 1.1 `shepherd/rules.ts`：`Rule.hook` 联合类型追加 `"session_compact"`；`Condition.field` 联合类型追加 `"reason"`
- [x] 1.2 `shepherd/rules-validate.ts`：`VALID_HOOKS` 追加 `"session_compact"`；conditions 校验的 validFields 追加 `"reason"`
- [x] 1.3 ~~conditions.ts: matchBuiltinCondition 支持 reason~~ 【实施修正】主匹配路径 `matchCondition` 为 `targets[field]` 泛型取值，reason 匹配天然支持，conditions.ts 无需改动；由 handler 构造 targets 时携带 reason key（见 2.1）

## 2. compaction handler

- [x] 2.1 新建 `shepherd/compaction.ts`：`registerSessionCompact(pi, state, rulesDir, rulesOptions)`，模式照 `message-end.ts`——`pi.on("session_compact")` → 过滤 hook 规则 → enabled/isSubagent/toolsAvailable 检查 → 手工 targets `{text:"",path:"",command:"",glob:"",reason}` → conditions/pattern 匹配 → `pushWarning(rule.reason, rule.comment)`；不引入 _fired 去重、不 sendMessage(triggerTurn)
- [x] 2.2 `shepherd/index.ts` barrel 追加导出；根 `index.ts` 注册 `registerSessionCompact(pi, state, RULES_DIR, rulesOptions)`
- [x] 2.3 全局 rules.json 追加默认规则 `compact-skill-reminder`（hook: session_compact，action: steer，引导性文案，enabled: true）【reload 后经 shepherd_rules 工具写入成功，global:36】

## 3. 测试

- [x] 3.1 handler 行为：mock pi 捕获 on("session_compact") handler，手动触发 event——三种 reason × 有/无规则 × enabled=false 跳过 × 子代理默认跳过（isSubagent）断言 hasHints/drainHints
- [x] 3.2 conditions 过滤：field "reason" + pattern "threshold|overflow" 时 manual 不触发、无条件时全触发；validateRule 对 hook "session_compact" 与 field "reason" 的接受/拒绝路径
- [x] 3.3 无 _fired 去重语义：同一会话连续两次压缩事件，两次都 pushWarning
- [x] 3.4 回归：`npm test` 全绿 + `npm run typecheck` 0 错（规则对象用 tests/helpers.ts 的 makeRule/makeCondition）

## 4. 验证与收尾

- [x] 4.1 手动冒烟：本会话 /compact 实测——压缩后下一请求 drainHints 注入 compact-skill-reminder 文案，AI 侧亲眼观察到注入 ✅（首次尝试因大会话摘要耗时被取消，重试成功）
- [ ] 4.2 `npm run typecheck` + `npm test` 最终门禁通过，git commit（遵循 shepherd 提交规范）
