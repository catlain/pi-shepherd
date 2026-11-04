/**
 * hint 注入器 — before_provider_request 临时提示注入
 *
 * 收集两类提示并注入 LLM payload（不写入 session 历史）：
 *   1. shepherd 规则 hints（drainHints，ephemeral-shared 队列）
 *   2. 跨扩展 hints（pi.events.emit("ephemeral:hint")，绕过 jiti 多实例）
 *
 * 注入后 payload 末尾追加一条 user 消息；同时 ctx.ui.notify 展示
 * （short 摘要优先，fallback notifySummary 截断）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notifySummary } from "./ephemeral";
import { drainHints } from "./ephemeral-shared";

/** pi payload 消息结构的最小类型 */
interface PayloadMessage {
	role: string;
	content?: unknown;
	[key: string]: unknown;
}

/** pi provider payload 的最小类型 */
interface ProviderPayload {
	messages?: PayloadMessage[];
	[key: string]: unknown;
}

/** 本地 hints 缓冲区（收集 pi.events.emit("ephemeral:hint") 的数据） */
const _localHints: { text: string; short?: string }[] = [];

export function registerHintInjector(pi: ExtensionAPI) {
	// ── 监听跨扩展 hints（通过 pi.events 绕过 jiti 多实例） ──
	pi.events.on("ephemeral:hint", (data) => {
		const { text, short } = data as { text: string; short?: string };
		_localHints.push({ text, short });
	});

	// ── before_provider_request：注入临时提示 ──────────────────
	pi.on("before_provider_request", async (event, ctx) => {
		// shepherd 规则 hints
		const shepherdText = drainHints();
		if (shepherdText) {
			_localHints.unshift({ text: shepherdText });
		}

		// 通知摘要：short 优先，fallback 到 notifySummary 截断
		const shortParts = _localHints
			.map((h) => h.short)
			.filter(Boolean) as string[];
		const longParts = _localHints
			.map((h) => (h.short ? null : h.text))
			.filter(Boolean) as string[];
		const notifyText = [...shortParts, ...longParts].join("\n\n");

		const allHints = _localHints
			.splice(0)
			.map((h) => h.text)
			.join("\n\n");
		let payload = event.payload as ProviderPayload;

		if (allHints) {
			const text = allHints;
			payload = { ...payload };
			payload.messages = [...(payload.messages ?? [])];
			payload.messages.push({
				role: "user",
				content: [{ type: "text", text }],
			});
			ctx.ui.notify?.(notifySummary(notifyText), "warning");
		}

		return payload;
	});
}
