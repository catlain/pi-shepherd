/**
 * Shepherd 专用提示缓冲区
 *
 * shepherd 规则触发的 steer/notify 提示通过 pushWarning 推入，
 * 由共享的 ephemeral 注入机制在 before_provider_request 时发送。
 * 提示只对当前请求生效，不写入 session 历史。
 */

/** 推入一条 shepherd 提示（自动加 ⚠️ shepherd: 前缀） */
export function pushWarning(reason: string, label?: string): void {
	// shepherd 前缀用于通知气泡识别，注入时由 injectHints 统一处理
	pushShepherdHint(reason, label);
}

/** 生成通知气泡用的摘要（优先用规则名列表，fallback 截断 reason） */
export function notifySummary(text: string, labels?: string[]): string {
	// 优先使用规则名（comment）列表
	if (labels && labels.length > 0) {
		const joined = labels.join("、");
		return joined.length > 120 ? joined.slice(0, 117) + "..." : joined;
	}
	// fallback：截取第一个 --- 之前的内容
	const idx = text.indexOf("\n---");
	if (idx > 0) return text.slice(0, idx);
	if (text.length > 120) return text.slice(0, 117) + "...";
	return text;
}

// ── 内部：shepherd 前缀推入共享缓冲区 ──

import { pushHint as _pushShared, hasHints } from "./ephemeral-shared.js";
const SHEPHERD_PREFIX = "⚠️ shepherd: ";

function pushShepherdHint(reason: string, label?: string): void {
	_pushShared(`${SHEPHERD_PREFIX}${reason}`, label);
}

/** 推入规则格式错误提示（加 ❌ 前缀区别于普通 warning） */
export function pushRuleError(msg: string): void {
	_pushShared(`❌ shepherd 规则格式错误: ${msg}`);
}

/** shepherd 是否有待发送的提示 */
export function hasWarnings(): boolean {
	return hasHints();
}
