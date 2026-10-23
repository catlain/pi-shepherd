---
id: ADR-0003
title: 扩展可代理写宿主内置 section，条件是共享写入设施+同构校验+不依赖宿主内部 API
status: active
subsystem: uncategorized
date: 2026-11-04
---

- **日期**: 2026-11-04
- **状态**: Accepted
- **决策**: pi-atelier 扩展（如 pi-shepherd 的 `/compact-config trigger`）允许代理写入 pi 宿主内核读取的 settings.json section（`compaction.modelOverrides`），但必须同时满足三个条件：写入仅经 shared-utils 的 `patchSettingsSectionWithBackup`（文件锁+备份+与 pi SettingsManager 互斥）、写入前做与宿主校验同构的最小校验（非法值会导致宿主 `getCompactionTokenSetting` 直接 throw，非静默忽略）、只写自己声明的字段面（如仅 `modelOverrides` 单字段），不读写其他字段、不依赖宿主内部 API。
- **原因**: pi 内置 compaction 触发点配置（reserveTokens/modelOverrides）无命令入口，用户只能手改 JSON 且「预留量」语义与「触发点」心智错位、换模型语义漂移。向上游提命令节奏不可控，生态先闭环。settings.json 本就是扩展与宿主共享的单一配置源（扩展已写自家 section），扩展写宿主 section 的风险不在写入本身而在竞态与校验——由共享写入设施与同构校验约束兜底。
- **替代方案（被否）**: ① 提上游 PR 由 pi 官方出命令——节奏不可控，且 trigger 语义封装（换算）生态内可先行验证；② 扩展在自家 section 镜像 compaction 配置再引导用户手抄——双份真源必然漂移；③ 不做，让用户继续手改 JSON——语义陷阱（预留量 vs 触发点、恒触发配置）无法消除。
- **影响**: pi-shepherd 新增 `shepherd/compact-trigger.ts`（读-改-整体写回宿主 section）；读取必须用原始透传 API（`getSettingsValue`），不可用 `getEffectiveConfig`/`getSettingsSection`——后两者按 defaults 白名单过滤字段，宿主 section 字段集合不固定，传 `{}` 会读成空对象（实施实测踩坑）。未来其他扩展写宿主 section 时复用本判例三条件。
- **证据来源**: change compact-config-unified / design.md 决策 D5
