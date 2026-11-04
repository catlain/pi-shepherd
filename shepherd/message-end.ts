/**
 * message_end hook 处理逻辑
 *
 * 在 AI 助手回复完成后，对回复文本进行正则匹配，
 * 触发 notify（弹通知）或 steer（注入下一轮）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { judgePasses } from "./llm-judge";
import { pushWarning } from "./ephemeral";
import {
	isSubagent,
	type LoadRulesOptions,
	loadRules,
	ruleMatches,
} from "./rules";
import type { ToolState } from "./tool-hooks";
import { toolsAvailable } from "./tool-hooks";

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

/** llmJudge 命中待提醒标志：agent_before_settle 消费（continue: true 驱动下一 provider request） */
let _llmJudgePending = false;

/** 置 llmJudge 待提醒标志（message_end 命中时调用） */
export function setLlmJudgePending(): void {
	_llmJudgePending = true;
}

/** 消费 llmJudge 待提醒标志（agent_before_settle 调用，读后即清） */
export function consumeLlmJudgePending(): boolean {
	const v = _llmJudgePending;
	_llmJudgePending = false;
	return v;
}

/** 重置防重复标记（agent_start 时调用） */
export function resetMessageEndState(): void {
	_messageEndFired.clear();
	_llmJudgePending = false;
}

/** 注册 message_end hook */
export function registerMessageEnd(
	pi: ExtensionAPI,
	state: ToolState,
	rulesDir?: string,
	rulesOptions?: LoadRulesOptions,
): void {
	pi.on("message_end", async (event, _ctx) => {
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

		let llmJudgePushed = false;

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

			// LLM 二级判定：正则通过后语义精判（fail-closed：失败按命中处理）
			// 判定“否” → 不触发、不标记防重复（下一条消息可重新判定）
			if (rule.llmJudge) {
				const pass = await judgePasses(rule, text);
				if (!pass) continue;
				llmJudgePushed = true;
			}

			// 标记已触发
			_messageEndFired.add(rule.comment);

			// 执行 action
			if (rule.action === "steer") {
				pushWarning(rule.reason, rule.comment);
			} else if (rule.action === "notify" || !rule.action) {
				pushWarning(rule.reason, rule.comment);
			}
		}

		// llmJudge 命中：置待提醒标志，由 agent_before_settle 统一消费——
		// 返回 continue: true 让 pi 官方机制驱动下一 provider request
		// （"ensure one next provider request"），零 sendMessage、零 setTimeout、零竞态；
		// 下一 request 的 before_provider_request → drainHints 注入提醒 → AI 回应。
		// 死循环防护：提醒 turn 的回应若再命中规则，_messageEndFired 防重复兜住，
		// 标志不再置位 → 收敛。
		if (llmJudgePushed) {
			setLlmJudgePending();
		}
	});
}
