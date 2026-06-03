/**
 * message_end hook 处理逻辑
 *
 * 在 AI 助手回复完成后，对回复文本进行正则匹配，
 * 触发 notify（弹通知）或 steer（注入下一轮）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pushWarning } from "./ephemeral.js";
import {
	isSubagent,
	type LoadRulesOptions,
	loadRules,
	type Rule,
	ruleMatches,
} from "./rules.js";
import type { ToolState } from "./tool-hooks.js";
import { getAvailableTools, toolsAvailable } from "./tool-hooks.js";

// ── 文本提取 ──────────────────────────────────────────────────

/** assistant 消息中的 content block 类型 */
interface TextBlock {
	type: "text";
	text: string;
}

/**
 * 从 assistant 消息中提取所有文本 content blocks 并拼接。
 * 安全处理 null/undefined/非数组 content。
 */
export function extractAssistantText(
	message: { role: string; content?: unknown } | null | undefined,
): string {
	if (!message?.content || !Array.isArray(message.content)) return "";
	return (message.content as Array<unknown>)
		.filter(
			(block): block is TextBlock =>
				!!block &&
				typeof block === "object" &&
				(block as any).type === "text" &&
				typeof (block as any).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

// ── message_end hook 注册 ─────────────────────────────────────

/** 防重复触发的 rule comment 集合 */
const _messageEndFired = new Set<string>();

/** 重置防重复标记（agent_start 时调用） */
export function resetMessageEndState(): void {
	_messageEndFired.clear();
}

/** 注册 message_end hook */
export function registerMessageEnd(
	pi: ExtensionAPI,
	state: ToolState,
	rulesDir?: string,
	rulesOptions?: LoadRulesOptions,
): void {
	pi.on("message_end", async (event, ctx) => {
		// 只处理 assistant 消息
		const message = event.message;
		if (!message || (message as any).role !== "assistant") return;

		const rules = loadRules(rulesDir, rulesOptions).filter(
			(r) => r.hook === "message_end",
		);
		if (rules.length === 0) return;

		// 提取 AI 回复的纯文本
		const text = extractAssistantText(message as any);
		if (!text) return;

		// 构造匹配目标：只有 text 字段
		const targets = { text, path: "", command: "", glob: "" };

		for (const rule of rules) {
			// 跳过禁用规则
			if (rule.enabled === false) continue;
			// 子代理控制
			if (isSubagent() && rule.subagent === false) continue;
			// 工具依赖检查
			if (!toolsAvailable(rule, pi, state)) continue;
			// 防重复触发
			if (_messageEndFired.has(rule.comment)) continue;

			// 条件匹配
			if (rule.conditions && rule.conditions.length > 0) {
				if (!ruleMatches(rule, targets, undefined, "")) continue;
			} else if (rule.pattern) {
				// 单条件模式：pattern 匹配 text
				const re = rule._compiled ?? new RegExp(rule.pattern, rule.flags || "");
				if (!re.test(text)) continue;
			} else {
				// 无条件：无条件匹配（总是触发）
			}

			// 标记已触发
			_messageEndFired.add(rule.comment);

			// 执行 action
			if (rule.action === "steer") {
				pushWarning(rule.reason, rule.comment);
			} else if (rule.action === "notify" || !rule.action) {
				// 默认 notify
				pushWarning(rule.reason, rule.comment);
			}
		}

		// 不再在此处发送 sendMessage(triggerTurn)。
		// agent_end 会统一检查 hasWarnings() 并发送唯一的 triggerTurn，
		// 避免 message_end 和 agent_end 各发一个 sendMessage 导致第二个 drainHints 空 → 空回复。
		//
		// 时序：message_end → turn_end → agent_end
		// message_end 推入的 warning 会在 agent_end 的 sendMessage 触发后被 drainHints 消费。
	});
}
