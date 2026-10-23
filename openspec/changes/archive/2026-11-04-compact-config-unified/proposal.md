## Why

pi 内置自动压缩的触发点由 `compaction.reserveTokens`（settings.json，支持 `modelOverrides` 按模型覆盖）控制，但没有任何命令入口——只能手改 JSON。用户心智模型是「多少 token 时压缩」（如 200k），而配置项语义是「预留量」（如 800k），需要按模型 contextWindow 手工换算，且换模型后同一预留量语义完全漂移（800k 预留在 200k 窗口模型上会恒触发压缩）。

`/compact-config` 已是「压缩行为域」的配置入口（当前管压缩后恢复注入），但参数形态是裸数字/开关，无法自然扩展第二个配置对象。借此将参数统一为两段式（子命令 + 值），同时补上触发点的命令化设置。

## What Changes

- **BREAKING** 统一 `/compact-config` 参数为两段式：现有裸数字（`/compact-config 50000`）与 `on|off` 形态收编为 `/compact-config tokens <N|on|off>`，旧形态不再接受（自家生态、使用频率低，直接切换不保留兼容）
- 新增 `/compact-config trigger <N>` 子命令：以「触发点」语义设置当前模型的自动压缩触发点，内部换算 `reserveTokens = ctx.model.contextWindow − N` 后写入全局 settings.json 的 `compaction.modelOverrides["{provider}/{id}"]`
- 新增 `/compact-config trigger`（无值）子命令：删除当前模型的 override，回退默认（接近满窗口触发，reserveTokens=16384）
- 无参 `/compact-config` 查看输出扩展为两块：恢复注入配置（contextRestore）+ 当前模型触发点（换算后语义值 + 内部 reserveTokens 存储值）
- 纯数字参数（trigger 的 N）：沿用生态惯例，不支持单位后缀（`200k` 需写作 `200000`）

## Capabilities

### New Capabilities

- `compact-trigger-config`: 以 trigger（触发点）语义管理 pi 内置自动压缩的按模型触发点——设置（数字换算写入 modelOverrides）、删除（回默认）、查看（显示换算值与存储值）。

### Modified Capabilities

- `context-restore`: `/compact-config` 的参数语法由「无参查看 / 裸数字设 maxTokens / on|off 开关」变更为「无参查看 / `tokens <N|on|off>` / `trigger <N|空>`」两段式；无参查看输出新增触发点信息块；旧裸数字与裸 on/off 语法废弃。

## Impact

- **代码**：`pi-shepherd/shepherd/commands.ts`（参数解析重构 + trigger 分支）；可能新增 `shepherd/compact-trigger.ts`（换算/读写/删除逻辑，保持 commands.ts 薄）
- **写入目标**：全局 `~/.pi/agent/settings.json` 的 `compaction` section（**首次由扩展写宿主内置 section**，经 shared-utils `patchSettingsSection` 锁+备份）
- **依赖**：`ctx.model`（ExtensionContext 已暴露 provider/id/contextWindow）；`patchSettingsSection` 对嵌套 key 删除的支持能力待验证（fallback：读-改-整体写回）
- **风险**：pi 升级若变更 compaction section 结构（`getCompactionTokenSetting` 对非法值直接 throw），写入前需做最小校验；pi 官方未来若出同名命令则冲突
- **测试**：`tests/compact-config.test.ts` 重写（新参数形态），新增 trigger 换算/删除用例
