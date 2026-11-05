/**
 * 恢复事件审计日志 + shepherd 通用诊断日志。
 *
 * 背景：TUI 的 ui.notify 实测不可见——"info" 级被
 * showExtensionNotify 降级为瞬态状态栏文本（压缩流程的状态更新立刻
 * 淹没它），"warning" 级同样验收不可见。裸 console.error/warn 直达
 * 终端 stderr，TUI 前台运行时会打坏输入框渲染（2026-11 实证：加载
 * 诊断警告混入用户输入框）。弃用 TUI 通道与裸 console，诊断一律写
 * 文件日志，排障/验收口径 = 日志文件内容。
 *
 * 路径：~/.pi/agent/logs/shepherd-restore.log（恢复管线）、
 *       ~/.pi/agent/logs/shepherd.log（通用诊断：规则加载警告、
 *       llmJudge 失败诊断、无效组合警告等）。
 * 日志失败静默——绝不能影响主流程。
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function logDiagnostic(line: string): void {
	try {
		const dir = join(homedir(), ".pi", "agent", "logs");
		mkdirSync(dir, { recursive: true });
		const sid = (process.env.PI_SESSION_ID ?? "").slice(0, 8) || "-";
		appendFileSync(
			join(dir, "shepherd.log"),
			`${new Date().toISOString()} sid=${sid} ${line}\n`,
		);
	} catch {
		// 静默降级：诊断日志绝不干扰主流程（兜底也不打 stderr——TUI 场景裸输出会破坏渲染）
	}
}

export function logRestore(line: string): void {
	try {
		const dir = join(homedir(), ".pi", "agent", "logs");
		mkdirSync(dir, { recursive: true });
		const sid = (process.env.PI_SESSION_ID ?? "").slice(0, 8) || "-";
		appendFileSync(
			join(dir, "shepherd-restore.log"),
			`${new Date().toISOString()} sid=${sid} ${line}\n`,
		);
	} catch (e) {
		// 静默降级：不干扰压缩主流程，但 stderr 留痕——避免排障工具自身成为盲区
		console.error("[shepherd] logRestore failed:", e);
	}
}
