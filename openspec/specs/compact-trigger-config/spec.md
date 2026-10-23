# compact-trigger-config Specification

## Purpose

pi 内置自动压缩的触发点由全局 settings.json 的 `compaction.reserveTokens` 控制（支持 `modelOverrides` 按模型覆盖），但无命令入口且配置语义是「预留量」而非用户心智的「触发点」——手工换算易错，且同一预留量在不同窗口模型上语义漂移（预留 ≥ 窗口即恒触发）。本能力以 `/compact-config trigger` 命令提供触发点语义封装：内部换算 `reserveTokens = contextWindow − trigger` 写入当前模型的 override，支持设置（数字）、删除（无值回默认）、查看（换算值与存储值并示）。

## Requirements

### Requirement: 触发点设置（trigger 数字）

`/compact-config trigger <N>` SHALL 以「触发点」语义设置当前模型的自动压缩触发点：内部按 `reserveTokens = ctx.model.contextWindow − N` 换算，写入全局 settings.json 的 `compaction.modelOverrides["{provider}/{id}"]`（key 由 ctx.model 自动构造，用户无需感知）。

- N 的有效区间 SHALL 为 `[30000, contextWindow − 16384]`；区间外或非整数 SHALL 拒绝且配置不变
- 写入 SHALL 走 patchSettingsSection（文件锁 + 备份），写入值为非负安全整数（与 pi 内核 getCompactionTokenSetting 校验同构）

#### Scenario: 设置触发点
- **WHEN** 当前模型为 `zai/glm-5.3`（contextWindow 1000000），用户执行 `/compact-config trigger 200000`
- **THEN** `compaction.modelOverrides["zai/glm-5.3"].reserveTokens = 800000` 写入全局 settings.json，notify 确认（显示触发点 200000 与换算后的 reserveTokens）

#### Scenario: 校验区间拒绝
- **WHEN** 用户执行 `/compact-config trigger 10000`（低于下限 30000）或 `/compact-config trigger 999999`（高于 contextWindow − 16384）或 `/compact-config trigger abc`
- **THEN** notify 报错并给出有效区间，配置不变

#### Scenario: 无模型上下文拒绝
- **WHEN** ctx.model 为 undefined（无当前模型可定位 override key）
- **THEN** notify 报「无当前模型」提示，配置不变

### Requirement: 删除 override 回默认（trigger 无值）

`/compact-config trigger`（子命令后无参数）SHALL 删除当前模型在 `compaction.modelOverrides` 中的 override 条目，触发行为回退默认（reserveTokens=16384，接近满窗口触发）。删除 SHALL 采用「读当前 compaction section → 删目标 key → 整体写回」方式（或经验证的等价 patch 删除能力）。

#### Scenario: 删除后回默认
- **WHEN** `modelOverrides["zai/glm-5.3"]` 存在，用户执行 `/compact-config trigger`
- **THEN** 该 key 从 modelOverrides 中移除（其余模型 override 不受影响），notify 确认「已回默认 reserveTokens=16384」

#### Scenario: 无 override 时幂等提示
- **WHEN** 当前模型在 modelOverrides 中无条目，用户执行 `/compact-config trigger`
- **THEN** 配置不变，notify 提示「当前模型无 override，已是默认行为」

### Requirement: 无参查看含触发点信息

无参 `/compact-config` 的查看输出 SHALL 包含自动压缩触发点块：当前模型 override 存在时显示「触发点（换算语义值）+ reserveTokens 存储值 + contextWindow」，不存在时显示默认行为说明。

#### Scenario: 有 override 的查看
- **WHEN** `modelOverrides["zai/glm-5.3"].reserveTokens = 800000` 存在，用户执行 `/compact-config`
- **THEN** 触发点块显示 `zai/glm-5.3 = 200000 tokens（reserveTokens=800000，窗口 1M）`

#### Scenario: 无 override 的查看
- **WHEN** 当前模型无 override，用户执行 `/compact-config`
- **THEN** 触发点块显示当前模型名与默认行为（接近满窗口触发）
