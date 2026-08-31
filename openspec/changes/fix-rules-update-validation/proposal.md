# Proposal: fix-rules-update-validation

## Why

会话 bd1c-72a49927471c 实证：对含 `conditions[].field: "command"` 的存量规则执行 `shepherd_rules update(index=N, changes={reason:...})` 被拒绝，报错 `conditions[0].field 值无效: "command"，合法值: path, text, glob, result`。随后 AI 被 bash 防绕过规则拦截，最终被迫用 `edit` 工具裸改 JSON（中途丢引号），完全绕过了备份+校验+回滚安全通道。

三个独立缺陷：

1. **校验器与匹配器漂移**：匹配引擎（rules.ts:318）对 bash 工具主动生成 `command` field，但校验器运行副本的合法值列表不含 `command`。git HEAD 的 `rules-validate.ts:70` 已补，但运行中的加载副本仍旧，说明"源码修了≠运行副本修了"缺少同步保障。
2. **update 连坐校验**：`updateRule()` 对 `{...旧规则, ...changes}` 整体严格校验。旧规则中当年合法、现在不合法的字段全部连坐，导致该规则任何字段都永远无法用工具更新——即使只想改 `reason` 或 `enabled`。
3. **防绕过体系自相矛盾**：update 工具因 Bug 1/2 拒绝合法操作 → AI 转投 bash → 被 block → 转投 edit 裸改 → 成功。安全网最终效果是"逼 AI 用最不安全的方式改文件"。附带缺陷 3b：bash 防绕过正则的 `cat` 分支会误伤命令中路径里的 `catlain`（github.com/**cat**lain/pi-shepherd），纯只读查询被误拦，进一步把 AI 往裸 edit 方向推。

## What Changes

- `validateRule()` 合法 field 列表补齐 `command`（与匹配引擎对齐），并**单一来源化**：由一处常量导出，匹配器与校验器共用，杜绝再次漂移。
- `updateRule()` 校验策略改为：**只对 `changes` 中出现的字段严格校验**；合并后对存量字段做校验但降级为警告（不拒绝写入），警告信息提示用 update 修复。
- bash 防绕过正则修正：`cat` 加词边界 `\bcat\b`，避免路径子串误伤；同时允许明确只读的检查场景（如 `node -e "require(...)"` 可通过词边界修复自然豁免）。
- 新增回归测试覆盖以上三个场景。

## Impact

- 代码：`shepherd/rules-validate.ts`、`shepherd/rules-editor.ts`、`shepherd/rules.ts`（常量提取）、`tests/`
- 兼容性：存量规则文件无需迁移；update 行为变化仅为放宽（原本被拒的合法操作现在可过，附警告）
- 风险：放宽 update 校验可能放过真正非法的 changes —— 由"changes 内字段严格校验"兜底
