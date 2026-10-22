/**
 * 恢复事件审计日志。
 *
 * 背景：TUI 的 ui.notify 实测不可见——"info" 级被
 * showExtensionNotify 降级为瞬态状态栏文本（压缩流程的状态更新立刻
 * 淹没它），"warning" 级同样验收不可见。弃用 TUI 通道，恢复管线的关键
 * 事件一律写文件日志，排障/验收口径 = 日志文件内容。
 *
 * 路径：~/.pi/agent/logs/shepherd-restore.log（append，带时间戳+会话短 ID）。
 * 日志失败静默——绝不能影响压缩后的主流程。
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function logRestore(line: string): void {
	try {
		const dir = join(homedir(), ".pi", "agent", "logs");
		mkdirSync(dir, { recursive: true });
		const sid = (process.env.PI_SESSION_ID ?? "").slice(0, 8) || "-";
		appendFileSync(
			join(dir, "shepherd-restore.log"),
			`${new Date().toISOString()} sid=${sid} ${line}\n`,
		);
	} catch {
		// 静默：日志失败不影响主流程
	}
}
