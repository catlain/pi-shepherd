/**
 * message_end hook 处理逻辑
 *
 * 在 AI 助手回复完成后，对回复文本进行正则匹配，
 * 触发 notify（弹通知）或 steer（注入下一轮）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { judgePasses, setJudgeContext } from "./llm-judge";
import { pushWarning } from "./ephemeral";
import {
	buildBuiltinContext,
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
		// 刷新 llmJudge 宿主上下文（扩展入口无 ctx 参数，事件回调才是权威来源）
		if (ctx) setJudgeContext(ctx);
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
				if (!ruleMatches(rule, targets, buildBuiltinContext(state), "")) continue;
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

		// llmJudge 命中：pushWarning（已完成）+ sendMessage(triggerTurn:false)
		// → isStreaming 分支下消息入 _pendingCustomMessages 队列，
		//   使 agent_before_settle 的 canContinue 判定（pendingCustomContext）为真，
		//   此时 handler 返回 continue: true 是合法的（否则 pi 报
		//   "requested continuation without runnable model context"）。
		// pi 官方机制驱动下一 provider request，drainHints 注入提醒 → AI 回应。
		// 死循环防护：提醒 turn 的回应若再命中规则，_messageEndFired 防重复兜住，
		// 不再 pushWarning → hasWarnings 为假 → 不再 continue → 收敛。
		if (llmJudgePushed) {
			try {
				Promise.resolve()
					.then(() =>
						pi.sendMessage(
							{
								customType: "shepherd-llm-judge",
								display: false,
								content: "",
							},
								{ triggerTurn: false },
							),
					)
					.catch(() => {
						// 会话已替换等场景：静默降级，提醒降为下轮 drainHints 注入
						});
			} catch {
					// 同步 throw 同降级
			}
		}
	});
}
