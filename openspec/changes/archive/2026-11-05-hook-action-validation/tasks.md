# Tasks: hook-action-validation

## 0. 失效规则普查与定因（已完成）

- [x] 0.1 全量普查 40 条规则四维度：组合矩阵（归一化 hook × action）、工具名存活（对照当前注册工具）、pattern 正则可编译、enabled 状态
- [x] 0.2 逐条定因：30（组合错，场景有效）、33（工具名漂移，工具活跃）、34（组合错，ro_query 活跃非退休）、4/5（显式停用，健康不处理）
- [x] 0.3 证据落档：设计文档 Context 定因表（含源码行号与 ro_query 活跃实证）

## 1. 支持矩阵单一来源（D1/D2）

- [x] 1.1 rules.ts 新增导出 `HOOK_ACTION_SUPPORT`：hook → 支持的 action 数组，每项注释消费分支的源码出处（tool_call/tool_result/message_end/session_compact/agent_end/session_shutdown——普查修正：agent_start 事件不消费规则，不在矩阵）
- [x] 1.2 rules.ts 新增导出 `normalizeHook(rule)`（缺省 = tool_call），rules.ts:168 的内联归一化改为调用它（运行时与校验同源）；合法值清单 VALID_ACTIONS/VALID_HOOKS 改由矩阵派生（D1 彻底落地，双清单漂移根除）

## 2. 校验器组合校验（D2/D3）

- [x] 2.1 rules-validate.ts：validateRule 增加组合校验——归一化 hook 后 action 必须在 HOOK_ACTION_SUPPORT[hook] 内；矩阵未收录的 hook 拒绝并提示「先更新矩阵」；报错文案附该 hook 的支持 action 列表；action 缺省归一化为 block（与运行时默认一致，堵无 action 规则静默失效）
- [x] 2.2 rules-editor.ts updateRule 的 changes 路径：changes 触及 hook/action 时合并后严格校验；未触及时存量无效组合降级警告（放行，防连坐）
- [x] 2.3 复用已达成：组合校验单一实现于 validateHookActionCombo，add（完整校验）/update（分层）双入口消费；safeWrite 回读只管 JSON 原子性（职责分离）

## 3. 运行时警告（D4）

- [x] 3.1 运行时警告单点落地：compileRules 出口统一检查（loadRules 为全部处理器公共入口，优于 6 处循环插入）；Set 去重防每次事件刷屏；不拦截规则加载、不影响其他规则执行
- [x] 3.2 警告文案含规则 comment 与 hook=xxx，便于定位（restore-log / stderr 可见）

## 4. 测试

- [x] 4.1 单测：HOOK_ACTION_SUPPORT 完整性（每个 VALID_HOOKS 成员都有矩阵条目）+ 矩阵值合法性
- [x] 4.2 单测：validateRule 组合校验（add 无效组合拒绝 / hook 缺省归一化后拒绝 / 矩阵未收录 hook 拒绝 / 合法组合放行 / action 缺省归一化）
- [x] 4.3 单测：update 分层（触及 action 且产生无效组合拒绝 / 未触及存量无效组合放行+警告 / 修复性 update 正常放行）
- [x] 4.4 单测：运行时警告（无效组合警告且不阻塞 / 归一化 hook 警告 / 合法零警告 / Set 去重）
- [x] 4.5 既有测试适配：compaction-validate（session_compact 补 action: steer）、rules-editor-validate（agent_end check 类补 action: notify）——新校验正确拦截「无 action 静默失效」形态，旧测试补显式合法 action 后全绿 708/708

## 5. 存量修复（D5，逐条定因处置 + 探针验证）

- [x] 5.1 shepherd_rules 修复 [global:30]：action steer→notify（组合错，场景有效）
- [x] 5.2 shepherd_rules 修复 [global:33]：tool→mcp__code_graph__module_overview（工具名漂移）
- [x] 5.3 shepherd_rules 修复 [global:34]：action steer→notify（组合错，ro_query 活跃非退休）
- [x] 5.4 探针实测三条修复后提醒可见（30=cargo/maturin 命令触发、33=module_overview 空路径触发、34=DataStore() 内联触发）
- [x] 5.5 兜底：实施中发现确凿失效但无法定因的规则 → 全文（含怀疑原因与证据）移入 changes/hook-action-validation/retired-rules.md 并从 rules.json 删除，最终报告列出待定夺（当前普查无条目，条件触发才执行）

## 6. 技能与文档同步（D6）

- [x] 6.1 shepherd-usage SKILL.md Schema 速查表：hook 行后补 hook×action 支持矩阵表
- [x] 6.2 SKILL.md 高频陷阱新增「工具名漂移」：MCP 工具必须用 mcp__server__tool 全名（toolMatches 纯精确匹配，无通配无后缀）
- [x] 6.3 SKILL.md 陷阱 1 示例替换：node -e → codemode 工具（node -e 会被规则 36 拦截）
- [x] 6.4 SKILL.md 管理规则区与「写入前自动校验」承诺对齐（补组合校验说明）；pi-shepherd README.md 同步矩阵与 MCP 工具名规范

## 7. 发版与收尾

- [x] 7.1 npm run typecheck + npm test 通过
- [x] 7.2 发版（按 npm-publish 技能流程）
- [x] 7.3 git commit + push（pi-shepherd 仓库，含 rules.json 修复与文档同步）
