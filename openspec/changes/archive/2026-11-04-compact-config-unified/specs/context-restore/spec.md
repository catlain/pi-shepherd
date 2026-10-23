# context-restore Delta Spec

## MODIFIED Requirements

### Requirement: 配置开关

contextRestore SHALL 通过 settings.json 的 `shepherd.contextRestore` 子键配置（`enabled` / `maxTokens`，无限文档个数配置），走 getEffectiveConfig 三层合并，默认 `enabled: true, maxTokens: 40000`。

`/compact-config` 对 contextRestore 的操作 SHALL 采用两段式参数 `tokens` 子命令：`/compact-config tokens <N|on|off>`；旧裸数字与裸 on/off 语法不再接受。

#### Scenario: 默认启用
- **WHEN** 用户未做任何 contextRestore 配置
- **THEN** 恢复注入按默认参数生效

#### Scenario: 显式关闭回落纯提醒
- **WHEN** `shepherd.contextRestore.enabled: false`
- **THEN** 不注入，压缩提醒维持纯提醒行为

#### Scenario: /compact-config 无参查看
- **WHEN** 用户执行 `/compact-config`
- **THEN** notify 展示两块信息：contextRestore 的 enabled/maxTokens 值、当前模型自动压缩触发点（换算语义值与内部 reserveTokens 存储值），附全部用法说明

#### Scenario: /compact-config tokens 设置预算
- **WHEN** 用户执行 `/compact-config tokens 50000`
- **THEN** maxTokens 安全写入 settings.json 的 shepherd.contextRestore（沿用既有校验：1000~400000 整数），notify 确认新值

#### Scenario: /compact-config tokens 开关
- **WHEN** 用户执行 `/compact-config tokens off`（或 on）
- **THEN** enabled 写入并 notify 确认；off 后不注入，维持纯提醒

#### Scenario: 旧语法废弃提示
- **WHEN** 用户执行 `/compact-config 50000`（裸数字）或 `/compact-config on`（裸开关）
- **THEN** notify 报「未知参数」并展示两段式用法示例，配置不变

#### Scenario: /compact-config 无效值拒绝
- **WHEN** 用户执行 `/compact-config tokens abc` 或 `/compact-config abc`
- **THEN** notify 错误提示（需要正整数或 on/off），配置不变
