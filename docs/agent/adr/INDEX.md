# ADR Index

> 编号 = 决策顺序，与创建日期解耦（时钟回拨/补录时可出现日期倒挂，如 ADR-0003 vs 0004）。新条目取现有最大编号+1。

| ID | 标题 | 状态 | 子系统 | 日期 |
|----|------|------|--------|------|
| ADR-0001 | 合法值清单以运行时常量为单一来源，类型从常量派生 | active | uncategorized | 2026-10-12 |
| ADR-0002 | 框架内建行为以独立模块旁挂，不进规则引擎 | active | uncategorized | 2026-10-12 |
| ADR-0003 | 扩展可代理写宿主内置 section（共享写入设施+同构校验+不依赖宿主内部 API） | active | uncategorized | 2026-11-04 |
| ADR-0004 | 跨包共享的领域清单逻辑沉淀 shared-utils 单一事实源，下游引用而非复制 | active | uncategorized | 2026-10-26 |
| ADR-0005 | 公用工具函数单源化——上收 shared-utils、同名转发门面为唯一兼容形态、业务适配层显式声明 | active | uncategorized | 2026-10-26 |
| ADR-0006 | hook×action 支持矩阵以导出常量为单一来源，校验清单从矩阵派生 | active | uncategorized | 2026-11-05 |
| ADR-0007 | 组合校验挂在归一化后的 hook 上，校验模型与运行时归一化同构 | active | uncategorized | 2026-11-05 |
| ADR-0008 | update 分层校验扩展到组合维度——触及才严、未触及降级 | active | uncategorized | 2026-11-05 |
