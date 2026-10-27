# Tasks: audit-fixes-single-source

> 补记性 change——全部任务在归档前的三批发版中已实施完成，此处记录实施轨迹。

## 1. W1 归一化上收（shared-utils 1.2.1 / shepherd 0.3.2）

- [x] 1.1 shared-utils `pushHint` 源头归一化（`_labels.push(label || undefined)`）+ 空 label 测试用例 → 发 1.2.1
- [x] 1.2 shepherd `ephemeral-shared.ts` 拆包装层恢复直通 re-export；`ephemeral.ts` 注释指向源头 → 发 0.3.2（657 测试全绿验证契约保持）

## 2. S3 别名删除（context-manager 0.2.0）

- [x] 2.1 sed 全部测试 import 新名（`isSkillMdPath` / `isOpenspecDesignDocPath`），删 distill-helpers 别名 re-export 块 → 原名转发替代
- [x] 2.2 全量 823 测试全绿 → 发 0.2.0（minor：删导出）

## 3. S5 四名归一（shared-utils 1.3.0 / context-manager 0.2.0 / shepherd 0.3.3）

- [x] 3.1 shared-utils 新建 `tokens.ts`（`estimateTokens` 单一源头）+ 测试 + barrel → 发 1.3.0
- [x] 3.2 context-manager：删 distill-helpers 本地实现（同名转发门面）、collect.ts `est` 内联、payload/core.ts 改显式适配层（`max(1, base)` + 注释）；12 处消费方 + 8 处 mock 属性名对齐；processor-write mock 改 importOriginal 透传
- [x] 3.3 shepherd：删 `estimateDocTokens` 本地实现与导出，context-restore 改 import → 发 0.3.3
- [x] 3.4 registry 传播延迟踩坑三次（1.2.0 / 1.2.1 / 1.3.0 各等一轮）→ 已沉淀记忆

## 4. 补记收口

- [x] 4.1 本 change 工件（proposal / design / tasks）
- [x] 4.2 决策沉淀为 ADR-0005（比补记 0004 更干净：0004 管领域清单、0005 管公用工具函数——单源化三分法：纯重复上收/异名删除/业务差异显式化）
- [x] 4.3 归档本 change
