Affects-subsystem: uncategorized

# Design: fix-rules-update-validation

## Context

- 匹配引擎 `shepherd/rules.ts:318`：`toolName === "bash"` 时以 `command` 作为条件 field。
- 校验器 `shepherd/rules-validate.ts:71`：`validFields = ["path", "text", "glob", "result", "command", "reason"]`（2026-10-12 复核现状：command 已入列，reason 为 10-10 add-compaction-reminder 新增）。
- 更新路径 `shepherd/rules-editor.ts:212-229`：`merged = {...rules[index], ...changes}` 后整条 `validateRule(merged)`，严格拒绝（与 8-31 引用一字未改，缺陷原样存在）。
- 防绕过规则（全局 rules.json global:33）：block bash 正则 `(rules\.json[\s\S]*(...|cat))|((...|cat)[\s\S]*rules\.json)`，裸 `cat` 无词边界。

**2026-10-12 复核补充实证（三缺陷均仍在）**：
1. **D1 必要性二次验证**：10-10 add-compaction-reminder 给 Condition 加 `"reason"` 时，仍需人工同步改两处（rules.ts 类型 union + rules-validate.ts validFields）——双清单人肉同步模式未变，只是这次同步成功了。
2. **D3 必要性二次验证**：10-12 会话实证，含 `github.com/catlain` 路径 cd 前缀 + rules.json 的只读 git diff/grep 命令被 global:33 误拦（右分支 `cat[\s\S]*rules\.json`：catlain 提供 cat 子串在前，跨序命中）。
3. **同根修复进展**：61aedac 已补 Condition 类型层 `"command"`，d0986c4 已删幽灵 `"session_end"`——与本 change 的 D1 同属双清单漂移治理，但 D1 的结构性根治（单一来源+类型派生）仍未做。
4. **并行安全**：与 in-flight 的 add-skill-restore-injection（compaction.ts 新模块 + index.ts）零文件重叠，可并行。

## Goals / Non-Goals

- Goals: 存量规则可被 update；校验与匹配单一来源；防绕过规则不再误伤只读命令。
- Non-Goals: 不做规则 schema 大版本迁移；不改 add 的严格校验；不拦截 edit/write 项目级 shepherd-rules.json（那是用户自己的文件，全局守卫只管本仓库全局文件）。

## Decisions

### D1. 合法 field 常量单一来源 + 类型派生（WHY: 两个文件两份列表必然再漂移；command/session_end 两次分叉 + reason 手动双改三重实证）

在 `rules.ts`（或新 `rule-schema.ts`）导出常量并**由常量派生类型**，编译期与运行时锁定同步：

```ts
export const VALID_CONDITION_FIELDS = [
	"path", "text", "glob", "result", "command", "reason",
] as const;
export type ConditionField = (typeof VALID_CONDITION_FIELDS)[number];

export interface Condition {
	field?: ConditionField;  // 类型从常量派生，不再手写 union
	...
}
```

`rules-validate.ts` 引用同一常量做运行时校验（顺带消灭当前函数内局部数组每次循环重建的浪费）。今后增改合法值只需改常量一处，类型/校验/工具描述文案全部联动。

- **Type**: layering-principle
- **Sediment-to**: ADR（双清单漂移共同根因治理，command/session_end 两次分叉背书）

### D2. update 分层校验（WHY: 整条连坐使存量规则永久锁死）
```
update(index, changes):
  1. strict-validate(changes)          # 动过的字段必须合法，错误拒绝
  2. merged = {...old, ...changes}
  3. warn-validate(merged)             # 存量字段问题 → 警告，不拒绝
  4. 写入 + 备份 + 回读（现有机制不变）
```

警告文本建议带修复指引：`存量字段 X 不再合法，建议 update(index, changes={conditions:[...]}) 修复`。

- **Type**: one-off
- **Sediment-to**: none

### D3. bash 防绕过正则词边界（WHY: "catlain" 含 "cat" 误伤实证，10-12 再次复现）

`cat` → `\bcat\b`，同理 `open\(` 已有边界、`write` 建议 `\bwrite\b`。修正后 `node -e "require('./rules.json')"` 与含 `github.com/catlain` 路径的只读命令不再误拦。

- **Type**: one-off
- **Sediment-to**: none

### D4. 运行副本同步问题记录（不修代码，修认知）

git HEAD 已含 `command` 但运行副本旧 → 扩展更新依赖 git pull + pi 重载。在本 change 的 README/发布说明中提醒：修复后需确认加载副本生效（可用一条含 command field 的 update 冒烟验证）。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- 放宽 update：恶意/错误 changes 由 D2 第 1 层严格校验兜底；存量字段警告而非静默通过，可观测。
- 正则收窄（词边界）：理论上 `echo ... > x;cat rules.json` 之类的复合命令中 `cat` 仍会被拦（词边界匹配独立单词），绕过空间未实质扩大。

## Migration Plan

无数据迁移。发布后冒烟：update 一条含 `command` field 的规则改 reason，应成功且无警告。

## Open Questions

- 警告校验失败是否需要持久化记录（日志），还是仅工具返回文本中提示？→ 倾向后者（shepherd 无运行时日志面）。
