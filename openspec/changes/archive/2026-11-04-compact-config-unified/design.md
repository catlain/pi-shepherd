# Design: compact-config-unified

Affects-subsystem: uncategorized

## Context

pi-shepherd 的 `/compact-config`（v0.1.2，change extend-context-restore 交付）管理 `shepherd.contextRestore`：无参查看 / 裸数字设 maxTokens / on|off 开关。同时，pi 内置自动压缩的触发点由 `compaction.reserveTokens`（全局 settings.json，支持 `modelOverrides` 按模型覆盖）控制，无命令入口，只能手改 JSON。

pi 内核事实（探索已验证）：

- 触发公式（`compaction.js:176`）：`contextTokens > contextWindow - reserveTokens`；默认 reserveTokens=16384
- override key 构造（`settings-manager.js:638`）：`` `${model.provider}/${model.id}` ``，如 `zai/glm-5.3`
- 读取优先级：`modelOverrides[key] ?? 顶层字段 ?? 默认`
- `getCompactionTokenSetting` 对非法值**直接 throw**（非负安全整数），非静默忽略
- `reserveTokens` 第二语义：摘要输出预算 `min(0.8 × reserveTokens, model.maxTokens)`
- 扩展命令 handler 的 `ctx.model`（ExtensionContext）已暴露 `provider/id/contextWindow`

用户现状：`modelOverrides["zai/glm-5.3"].reserveTokens = 800000`（1M 窗口 → 200k 触发）。参数格式已由用户拍板统一为两段式（子命令 + 值）。

## Goals / Non-Goals

**Goals:**

- `/compact-config` 参数统一两段式：`tokens <N|on|off>`、`trigger <N|空>`，无参查看显示两块配置现值
- trigger 以「触发点」语义暴露，内部换算 reserveTokens 写入 `compaction.modelOverrides[当前模型]`，天然规避恒触发配置
- `trigger` 无值删除当前模型 override，回退默认
- 沿用生态命令模式（aging-config 两词子命令解析、三段式 notify 反馈、patchSettingsSection 写入）

**Non-Goals:**

- 不管理 compaction 的其他字段（enabled、keepRecentTokens、顶层 reserveTokens、其他模型的 override）
- 不支持单位后缀（`200k`）、不支持 `--global` 顶层作用域
- 不向 pi 上游提命令（生态内闭环）
- 不为旧语法（裸数字/on|off）保留兼容层

## Decisions

### D1 参数统一两段式，直接切换（BREAKING）

`/compact-config 50000` → `/compact-config tokens 50000`；`/compact-config on` → `/compact-config tokens on`。旧裸数字与裸 on/off 形态废弃，报「未知参数」并展示用法。

- **Type**: one-off
- **Sediment-to**: none

理由：统一格式后所有变更操作都是「子命令 + 值」，一眼分清管的是恢复注入还是触发点；自家生态、命令低频、0.x 阶段，兼容层是长期债务（同 extend-context-restore D2 的 breaking 先例）。

### D2 trigger 语义封装：暴露触发点，内部换算 reserveTokens

`/compact-config trigger 200000` 内部执行 `reserveTokens = ctx.model.contextWindow − 200000`（1M 窗口 → 写 800000），写入 `modelOverrides["{provider}/{id}"]`。不暴露原生 reserveTokens 参数。

校验区间：`N ∈ [30000, contextWindow − 16384]`。下限防压缩循环（压缩后剩余 ≈ summary + keepRecentTokens 20k，触发点过近会反复触发）；上限保证 reserve ≥ 16384 默认余量（摘要请求有输出空间）。

- **Type**: one-off
- **Sediment-to**: none

理由：用户心智模型是「200k 时压缩」而非「预留 800k」；封装天然保证 `N < contextWindow`，不会写出恒触发配置（原生 reserve 在小窗口模型上 `reserve ≥ contextWindow` 即恒触发）。备选「直接暴露 reserveTokens」被否：换模型语义漂移陷阱由封装消除。

### D3 作用域：当前模型 override，key 自动构造

默认作用于 `ctx.model` 对应的 override key（`` `${provider}/${id}` ``），用户无需感知 key 格式。不做全局顶层字段写入。

- **Type**: one-off
- **Sediment-to**: none

理由：与用户现有手动配置形态一致；各模型 contextWindow 差异大（1M vs 200k），按模型独立调优是正确粒度。换模型后新模型回默认是预期行为（feature），查看输出中明示当前模型与默认值缓解「为什么没生效」疑惑。

### D4 `trigger` 无值 = 删除 override 回默认

`/compact-config trigger`（子命令后无参数）删除当前模型的 modelOverride，回退默认（reserveTokens=16384，接近满窗口触发）。与生态「无参=查看」惯例相反，是有意例外：trigger 的查看已由无参 `/compact-config` 承担，删除是 trigger 域的低频收尾操作，省去 `off`/`default` 子参数。

- **Type**: one-off
- **Sediment-to**: none

理由：参数面最小化；误删损失小（仅回默认，非数据丢失）。notify 明确反馈「已删除 override，回默认 reserveTokens=16384」。

### D5 扩展写宿主内置 section：shepherd 代理写 compaction

`compaction` section 由 pi 内核读取（SettingsManager），非 shepherd 自有地盘。本变更开创「扩展命令代理写宿主内置 section」的生态首例，边界约束：

- 写入仅经 shared-utils `patchSettingsSectionWithBackup`（文件锁 + 备份 + 与 pi SettingsManager 互斥；tokens/contextRestore 路径的 `patchSettingsSection` 为无锁旧路径，挂修复批升级）
- 写入前做与 pi 内核同构的最小校验（非负安全整数），杜绝写出触发 `getCompactionTokenSetting` throw 的值
- 单向写：shepherd 只写不读内核语义（读取用 `getEffectiveConfig` 读原始 JSON，不依赖 SDK 内部 API）

- **Type**: layering-principle
- **Sediment-to**: ADR

理由：这是「哪层拥有哪个配置」的职责边界决策——扩展可以代理写宿主 section，条件是走共享写入设施 + 同构校验 + 不依赖宿主内部 API。未来其他扩展写宿主 section 时复用此判例。备选「提上游 PR 由 pi 官方出命令」被否：节奏不可控，生态先闭环。

### D6 嵌套 key 删除：读-改-整体写回

**实施验证结论（Task 1.1）**：`patchSettingsSection`/`patchSettingsSectionWithBackup` 均为浅合并（`value !== undefined` 才写、嵌套对象整体替换）——既不能删 key，直接 patch `modelOverrides` 还会丢失其他模型的 override。故 set 与 remove **都**采用「读 compaction section → 手动合并/删除嵌套 key → 整体写回」，写入走 `patchSettingsSectionWithBackup`（文件锁 + 备份 + options.settingsPath 可测试注入）。

- **Type**: one-off
- **Sediment-to**: none

### D7 换算与读写逻辑独立模块

trigger 换算、override 读写/删除封装为 `shepherd/compact-trigger.ts` 纯函数模块（输入 model + settings，输出 patch），commands.ts 保持「解析 + notify」薄层。对照 context-restore.ts（纯函数）与 compaction.ts 回调（副作用）的职责分离先例。

- **Type**: one-off
- **Sediment-to**: none

## Risks / Trade-offs

- [pi 升级改 compaction section 结构或 key 解析] → 写入前同构校验兜底；写入字段仅 `modelOverrides[key].reserveTokens`，面窄；升级 pi 后手动跑一次 `/compact-config` 查看验证
- [pi 官方未来出 `/compact-config` 命令] → 命令名冲突时 shepherd 侧让位（pi 内置优先级更高），本 change 的 trigger 语义可迁移
- [trigger 无值=删除的隐式语义被误触] → 删除仅回默认（无损），notify 明确反馈；spec 中作为明确 Scenario 记录
- [breaking 切换后旧肌肉记忆打 `/compact-config 50000` 报错] → 报错文案直接给出新语法示例，一次学会
- [reserveTokens 第二语义（摘要预算）被大 reserve 改变] → 大 reserve 被 `model.maxTokens`（如 131072）截断，实际摘要预算不受影响（探索已验证）

## Migration Plan

单仓库单命令，无数据迁移。发布即切换：升级 pi-shepherd 后旧语法失效（报错提示新语法），现有 `shepherd.contextRestore` 配置不受影响，现有手动 `modelOverrides` 立即被 `/compact-config` 查看识别。

## Open Questions

（两项均已验证落地，结论并入 D6 与实现约束）

- **热生效时机（已验证，Task 1.2）**：SettingsManager 持有启动时内存快照，无文件 watcher，外部写盘**不热生效**——set/remove 的 notify SHALL 提示「新会话生效」，与 contextRestore 现有提示一致
- **patchSettingsSection 嵌套 key 删除能力（已验证，Task 1.1）**：不支持（浅合并 + undefined 跳过）→ D6 的读-改-整体写回为最终方案
