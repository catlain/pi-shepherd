---
id: ADR-0001
title: 合法值清单以运行时常量为单一来源，类型从常量派生
status: active
subsystem: uncategorized
date: 2026-10-12
---

- **日期**: 2026-10-12
- **状态**: Accepted
- **决策**: `conditions[].field` 的合法值由 `VALID_CONDITION_FIELDS` 运行时常量单一提供，`Condition.field` 类型用 `typeof VALID_CONDITION_FIELDS[number]` 从常量派生，校验器/匹配器/类型/文案全部引用该常量，禁止任何地方手写第二份清单。
- **原因**: TS 类型（编译期）与运行时校验数组（运行期）是两份独立清单，靠人肉同步维护。三次实证漂移：①command 分叉（类型缺、校验有、运行时支持，a7eb8ca 加 result 时重写 union 丢失）；②session_end 幽灵（类型有、校验无、SDK 从未有此事件，d0986c4 清理）；③reason 手动双改（10-10 add-compaction-reminder 被迫同步改 rules.ts 类型 + rules-validate.ts 数组两处）。同一合法值集合跨编译期/运行期两个表示域，任何非派生式的双清单必然再漂移。
- **替代方案（被否）**: ①仅"常量导出共用"不派生类型——类型仍是手写 union，类型层漂移未根治（8-31 原设计即此形态，reason 事件证明不够）；②从类型生成运行时清单（`keyof` 反推）——TS 无直接逆向运行时枚举的标准方式，需引入 codegen，复杂度不成比例；③接受双清单+人工纪律——三次漂移实证纪律不可靠。
- **影响**: `shepherd/rules.ts` 导出常量与 `ConditionField` 派生类型；`shepherd/rules-validate.ts` 引用常量做运行时校验（顺带消除函数内每次循环重建数组的浪费）；后续新增合法值（如未来的 hook/field 扩展）只改常量一处，tsc 与运行时自动联动。
- **证据来源**: change fix-rules-update-validation（design D1，用户确认 layering-principle）；同根修复 commit 61aedac（command 补类型）、d0986c4（session_end 幽灵清理）。
