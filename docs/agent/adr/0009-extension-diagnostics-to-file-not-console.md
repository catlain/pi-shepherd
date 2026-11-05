# ADR-0009: 扩展诊断输出一律落盘，禁止裸 console

- **Status**: Accepted
- **Date**: 2026-11-05
- **Context**: hook-action-validation 归档后热修复（pi-shepherd@0.4.4）

## Context

pi 扩展进程与 TUI 共享终端：扩展内裸 `console.error` / `console.warn` 直写
stderr，会打在 TUI 前台绘制区（输入框区域）上——不进对话上下文、不被 TUI
捕获、破坏界面渲染。

**同坑二踩记录**：

1. 2026-11-07：agent_end git 提醒的 `logRestore` 发现 TUI `ui.notify` 实测
   不可见、裸 console 直达终端破坏 TUI——当时结论「关键事件一律写文件」，
   但只落地了 `logRestore` 一条。
2. 2026-11-05：规则加载诊断（llmJudge 无效剥离警告等）仍是裸
   `console.error`，热重载后一次性输出，直接打在用户输入框（用户实测报障）。

## Decision

**shepherd 所有非注入类输出（加载诊断、运行时诊断、剥离警告）一律落盘，
禁止裸 console：**

| 场景 | 通道 | 文件 |
|------|------|------|
| 规则事件提醒（steer/notify） | `pushWarning` 队列 → `before_provider_request` 注入 | 对话上下文 |
| 加载/组合/llmJudge 剥离诊断 | `logDiagnostic` | `~/.pi/agent/logs/shepherd.log` |
| agent_end 恢复操作记录 | `logRestore` | `~/.pi/agent/logs/shepherd-restore.log` |
| llmJudge 判定过程 | `judgeLog` | `~/.pi/agent/logs/shepherd-llmjudge.log` |

唯一例外：日志函数自身写文件失败时的兜底 `console.error`（此时已无更优通
道）。

## Consequences

- 新增诊断场景时先接 `logDiagnostic`，不得新写 `console.*`
- 排障入口统一为日志文件（`read ~/.pi/agent/logs/shepherd.log`）
- 跨项目教训：其他 pi 扩展（atelier 生态）新增裸输出前对照本 ADR——
  TUI 共享终端前提下裸 console 即破坏渲染

## Alternatives Considered

- **捕获并重定向全局 console**：侵入性太强，掩盖真正的崩溃输出（进程级
  stderr 级错误仍需直达），不做。
- **改走 `ui.notify` / `showStatus`**：实测不可见（见 restore-log.ts
  2026-11-07 注释），不可靠。
