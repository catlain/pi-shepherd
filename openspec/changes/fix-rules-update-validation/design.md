# Design: fix-rules-update-validation

## Context

- 匹配引擎 `shepherd/rules.ts:318`：`toolName === "bash"` 时以 `command` 作为条件 field。
- 校验器 `shepherd/rules-validate.ts:70`：`validFields = ["path", "text", "glob", "result", "command"]`（git HEAD），运行副本事发时为四值。
- 更新路径 `shepherd/rules-editor.ts:212-229`：`merged = {...rules[index], ...changes}` 后整条 `validateRule(merged)`，严格拒绝。
- 防绕过规则（全局 rules.json 两条）：block edit/write `shepherd/rules\.json$`；block bash 中 rules.json 关联读写字符（`cat` 无词边界）。

## Goals / Non-Goals

- Goals: 存量规则可被 update；校验与匹配单一来源；防绕过规则不再误伤只读命令。
- Non-Goals: 不做规则 schema 大版本迁移；不改 add 的严格校验；不拦截 edit/write 项目级 shepherd-rules.json（那是用户自己的文件，全局守卫只管本仓库全局文件）。

## Decisions

### D1. 合法 field 常量单一来源（WHY: 两个文件两份列表必然再漂移）

在 `rules.ts`（或新 `rule-schema.ts`）导出：

```ts
export const VALID_CONDITION_FIELDS = ["path", "text", "glob", "result", "command"] as const;
```

`rules-validate.ts` 和任何需要合法值列表的地方（含工具描述文案）引用它。

### D2. update 分层校验（WHY: 整条连坐使存量规则永久锁死）

```
update(index, changes):
  1. strict-validate(changes)          # 动过的字段必须合法，错误拒绝
  2. merged = {...old, ...changes}
  3. warn-validate(merged)             # 存量字段问题 → 警告，不拒绝
  4. 写入 + 备份 + 回读（现有机制不变）
```

警告文本建议带修复指引：`存量字段 X 不再合法，建议 update(index, changes={conditions:[...]}) 修复`。

### D3. bash 防绕过正则词边界（WHY: "catlain" 含 "cat" 误伤实证）

`cat` → `\bcat\b`，同理 `open\(` 已有边界、`write` 建议 `\bwrite\b`。修正后 `node -e "require('./rules.json')"` 与含 `github.com/catlain` 路径的只读命令不再误拦。

### D4. 运行副本同步问题记录（不修代码，修认知）

git HEAD 已含 `command` 但运行副本旧 → 扩展更新依赖 git pull + pi 重载。在本 change 的 README/发布说明中提醒：修复后需确认加载副本生效（可用一条含 command field 的 update 冒烟验证）。

## Risks / Trade-offs

- 放宽 update：恶意/错误 changes 由 D2 第 1 层严格校验兜底；存量字段警告而非静默通过，可观测。
- 正则收窄（词边界）：理论上 `echo ... > x;cat rules.json` 之类的复合命令中 `cat` 仍会被拦（词边界匹配独立单词），绕过空间未实质扩大。

## Migration Plan

无数据迁移。发布后冒烟：update 一条含 `command` field 的规则改 reason，应成功且无警告。

## Open Questions

- 警告校验失败是否需要持久化记录（日志），还是仅工具返回文本中提示？→ 倾向后者（shepherd 无运行时日志面）。
