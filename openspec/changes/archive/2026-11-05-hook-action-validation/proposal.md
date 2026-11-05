# Proposal: hook-action-validation

## Why

2026-11-19 给规则 `[global:39]`（bash grep -r 引导）配置 `tool_call + steer` 时：shepherd_rules 添加校验通过、回读验证通过，**运行时却静默失败**——tool-hooks.ts 的 tool_call 分支只消费 block/rewrite/notify（源码 tool-hooks.ts:74-88），steer 无分支接住、无任何告警。用户实测发现提示未出现，排查数轮才定位。

**全量普查发现（40 条存量规则，四维度：组合矩阵 × 工具名存活 × 正则可编译 × 显式停用状态）**：

| 规则 | 失效形态 | 定因 |
|------|---------|------|
| `[global:30]` Rust pyd 验证 | `tool_call+steer` 组合无效（hook 缺省归一化为 tool_call，rules.ts:168） | 规则写错（组合）；场景仍有效（fuse-bead-puzzle maturin 工作流在用） |
| `[global:33]` module_overview 空结果提醒 | 工具名漂移：`code_graph_module_overview` vs 实际注册名 `mcp__code_graph__module_overview`（MCP 化加前缀；toolMatches 纯精确匹配，rules.ts:385） | 规则写错（工具名过时）；工具本身活跃 |
| `[global:34]` ro_query 引导 | 同 30 组合无效；ro_query 经查活跃（`D:\Project\Quant\quant-base\scripts\ro_query.py`，近期会话高频调用） | 规则写错（组合）；**非**工具退休 |
| `[global:4]/[5]` | `enabled=false` 显式停用，注释写明原因与去向 | 健康状态（正常弃用先例，不处理） |

根因：校验器只校验 action/hook **各自**的合法值清单，不校验**组合**有效性——「添加成功但永不生效」是配置型系统最隐蔽的失败模式，存量中 2 条早已踩中而无人知晓，33 的工具名漂移更是第三种静默失效形态（组合合法、名字对不上）。

## What Changes

1. **支持矩阵单一来源**：rules.ts 新增导出 `HOOK_ACTION_SUPPORT` 常量（hook → 支持的 action 数组），rules-validate.ts 与运行时警告消费同一常量（防「校验器矩阵与运行时分支漂移」——10-12 D1 同根因）
2. **校验器组合校验**：add/update 写入前校验归一化 hook（缺省 = tool_call）× action 组合；矩阵未收录的 hook 拒绝并提示更新矩阵；update 遵循分层校验（changes 触及 hook/action 才严格拒绝，未触及放行+警告，防 8-31 连坐重演）
3. **运行时警告**：各 hook 处理器遇不支持的 action 输出警告（restore-log 可见），不再静默吞掉
4. **存量修复（按定因逐条）**：`[30]`/`[34]` 修组合（steer→notify，语义等价的注入式提醒）、`[33]` 修工具名（加 `mcp__code_graph__` 前缀）
5. **技能与文档同步**：shepherd-usage SKILL.md（Schema 速查表补 hook×action 矩阵；新增「工具名漂移」陷阱；陷阱 1 的 `node -e` 示例替换为 codemode——它本身会被规则 36 拦；对齐「写入前自动校验」承诺与实现）；pi-shepherd README.md 同步矩阵与 MCP 工具名规范
6. **弃用文档兜底**：实施中若发现确凿失效但无法定因、需用户判断的规则 → 移入 `openspec/changes/hook-action-validation/retired-rules.md`（原规则全文+怀疑原因+证据），同时从 rules.json 删除，避免后续校验报错连坐。**当前普查无此类条目**（机制作为兜底写入）

## Capabilities

### Modified
- `rules-tool-validation`：新增 hook×action 组合校验 requirement（矩阵单一来源、归一化后校验、update 分层）

## Impact

- **代码**：`shepherd/rules.ts`（矩阵常量+normalizeHook 导出）、`shepherd/rules-validate.ts`（组合校验）、`shepherd/tool-hooks.ts`（运行时警告）
- **规则数据**：`pi-shepherd/rules.json` 修复 3 条（30/33/34）
- **技能/文档**：`~/.pi/agent/skills/shepherd-usage/SKILL.md`（4 处同步）、`pi-shepherd/README.md`
- **测试**：`tests/` 新增校验器组合/分层/警告用例
- 无 breaking：合法组合行为不变；仅无效组合在写入时被拒（正是目的）；存量修复走 shepherd_rules 工具
