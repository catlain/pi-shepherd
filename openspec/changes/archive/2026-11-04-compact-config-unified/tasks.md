## 1. 前置验证（design Open Questions 落地）

- [x] 1.1 验证 patchSettingsSection 对嵌套 key 删除的能力（undefined 值 / 整体写回两种路径），结论回写 design.md D6（若支持直删则简化）
- [x] 1.2 验证 SettingsManager 读 compaction 配置的时机（每次读盘 vs 启动快照）：改 reserveTokens 后不开新会话直接观察触发行为，结论决定 set 后 notify 是否加「新会话生效」提示

## 2. trigger 逻辑模块

- [x] 2.1 新建 `shepherd/compact-trigger.ts`：纯函数模块——`buildTriggerPatch(model, triggerTokens)`（区间校验 [30000, cw−16384] + reserveTokens 换算）、`buildTriggerRemoval(compaction, modelKey)`（读-改-整体写回的删除）、`describeTrigger(model, compaction)`（查看文本生成：换算语义值 + 存储值 + 窗口）
- [x] 2.2 单元测试 `tests/compact-trigger.test.ts`：换算正确性（1M 窗口 200000→800000）、区间边界拒绝（29999 / cw−16383 / 非整数 / 负数）、删除保留其他模型 override、无 override 幂等、无 model 拒绝

## 3. 命令重构（commands.ts）

- [x] 3.1 参数解析改两段式：`tokens <N|on|off>`（沿用既有 maxTokens 校验 1000~400000）、`trigger <N|空>`、无参查看；旧裸数字/裸 on/off 报「未知参数」并展示两段式用法
- [x] 3.2 无参查看输出扩为两块：contextRestore 块（现状）+ 触发点块（describeTrigger），附统一用法说明
- [x] 3.3 trigger 分支接 compact-trigger.ts：set（patchSettingsSection 写 compaction）/ remove（读-改-整体写回）/ 无 model 时的拒绝文案
- [x] 3.4 重写 `tests/compact-config.test.ts`：新参数形态全分支（tokens N / tokens on / tokens off / trigger N / trigger 空 / 旧语法拒绝 / 无效值 / 无参查看含两块），settings 写入 mock

## 4. 验证与收尾

- [x] 4.1 `npm test` + `npm run typecheck` 全绿
- [x] 4.2 真机冒烟：清 jiti 缓存 reload → `/compact-config trigger 200000` → 读 settings.json 确认 modelOverrides 写入 → `/compact-config` 查看显示两块 → `/compact-config trigger` 删除 → 确认回默认且其他模型 override 不受影响 → `/compact-config tokens 50000` 确认旧功能迁移正常
- [x] 4.3 （若 1.2 结论为热生效）跨会话验证：设置 trigger 后当前会话压缩触发点实测变化；README 命令表同步更新两段式语法
