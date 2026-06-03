/**
 * message_end hook 测试
 *
 * 测试 AI 回复文本匹配功能：
 * - extractAssistantText：从 AgentMessage 提取纯文本
 * - message_end hook 规则匹配逻辑
 * - steer/notify action 支持
 * - 防重复触发
 */

import { beforeEach, describe, expect, it } from "vitest";

// ── 模拟 AgentMessage 结构 ──

interface TextContent {
	type: "text";
	text: string;
}

interface ToolCall {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

interface SimAssistantMessage {
	role: "assistant";
	content: (TextContent | ToolCall)[];
	stopReason?: string;
}

// ── extractAssistantText（待实现）──

/**
 * 从 assistant 消息中提取所有文本 content blocks 并拼接
 */
function extractAssistantText(message: SimAssistantMessage): string {
	if (!message?.content || !Array.isArray(message.content)) return "";
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

// ── 模拟 message_end handler 的核心逻辑 ──

interface SimMessageEndRule {
	comment: string;
	hook: "message_end";
	conditions?: { field: string; pattern: string; _compiled?: RegExp }[];
	action: "notify" | "steer";
	reason: string;
	enabled?: boolean;
	_triggered?: boolean;
}

interface SimMessageEndState {
	aborted: boolean;
	triggeredRules: Set<string>;
	warnings: string[];
	hints: string[];
}

function simulateMessageEnd(
	state: SimMessageEndState,
	rules: SimMessageEndRule[],
	message: SimAssistantMessage,
): { warnings: string[]; hints: string[] } {
	if (state.aborted) return { warnings: [], hints: [] };

	const text = extractAssistantText(message);
	const newWarnings: string[] = [];
	const newHints: string[] = [];

	for (const rule of rules) {
		if (rule.enabled === false) continue;
		if (state.triggeredRules.has(rule.comment)) continue;

		let matched = false;
		if (rule.conditions && rule.conditions.length > 0) {
			matched = rule.conditions.every((cond) => {
				if (cond.field !== "text") return false;
				const re = cond._compiled ?? new RegExp(cond.pattern);
				return re.test(text);
			});
		}

		if (matched) {
			state.triggeredRules.add(rule.comment);
			if (rule.action === "notify") {
				newWarnings.push(rule.reason);
			} else if (rule.action === "steer") {
				newHints.push(rule.reason);
			}
		}
	}

	state.warnings.push(...newWarnings);
	state.hints.push(...newHints);
	return { warnings: newWarnings, hints: newHints };
}

// ── 测试 ──

describe("message_end hook", () => {
	describe("extractAssistantText", () => {
		it("提取纯文本 content blocks", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "Hello " },
					{ type: "text", text: "World" },
				],
			};
			expect(extractAssistantText(msg)).toBe("Hello \nWorld");
		});

		it("跳过 tool_use blocks", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [
					{ type: "text", text: "Let me check" },
					{ type: "tool_use", id: "1", name: "bash", input: { command: "ls" } },
					{ type: "text", text: "Done" },
				],
			};
			expect(extractAssistantText(msg)).toBe("Let me check\nDone");
		});

		it("空消息返回空字符串", () => {
			expect(extractAssistantText({ role: "assistant", content: [] })).toBe("");
		});

		it("null/undefined 安全", () => {
			expect(extractAssistantText(null as any)).toBe("");
			expect(extractAssistantText(undefined as any)).toBe("");
			expect(
				extractAssistantText({ role: "assistant", content: undefined } as any),
			).toBe("");
		});
	});

	describe("message_end 规则匹配", () => {
		const RULE_ENGLISH: SimMessageEndRule = {
			comment: "语言提醒：检测到英文回复",
			hook: "message_end",
			conditions: [
				{ field: "text", pattern: "\\b(I will|Let me|I'm going to)\\b" },
			],
			action: "notify",
			reason: "检测到英文回复，请使用中文",
		};

		const RULE_STEER: SimMessageEndRule = {
			comment: "引导：发现 TODO 注释建议",
			hook: "message_end",
			conditions: [{ field: "text", pattern: "TODO|FIXME" }],
			action: "steer",
			reason: "回复中提到了 TODO/FIXME，建议创建 Issue 或 Task 追踪",
		};

		let state: SimMessageEndState;

		beforeEach(() => {
			state = {
				aborted: false,
				triggeredRules: new Set(),
				warnings: [],
				hints: [],
			};
			// 预编译正则
			for (const rule of [RULE_ENGLISH, RULE_STEER]) {
				for (const cond of rule.conditions ?? []) {
					cond._compiled = new RegExp(cond.pattern);
				}
			}
		});

		it("英文回复触发 notify", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "I will fix the bug now." }],
			};
			const result = simulateMessageEnd(state, [RULE_ENGLISH], msg);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("英文");
		});

		it("中文回复不触发", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "我来修复这个 bug。" }],
			};
			const result = simulateMessageEnd(state, [RULE_ENGLISH], msg);
			expect(result.warnings).toHaveLength(0);
		});

		it("TODO 关键词触发 steer", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "这段代码有个 TODO 需要处理。" }],
			};
			const result = simulateMessageEnd(state, [RULE_STEER], msg);
			expect(result.hints).toHaveLength(1);
			expect(result.hints[0]).toContain("TODO");
		});

		it("多条件 AND 匹配", () => {
			const rule: SimMessageEndRule = {
				comment: "多条件测试",
				hook: "message_end",
				conditions: [
					{ field: "text", pattern: "error", _compiled: /error/i },
					{ field: "text", pattern: "fix", _compiled: /fix/i },
				],
				action: "notify",
				reason: "需要两个条件同时匹配",
			};
			// 两个都匹配
			const msg1: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "There is an error to fix." }],
			};
			expect(simulateMessageEnd(state, [rule], msg1).warnings).toHaveLength(1);

			// 只匹配一个
			const msg2: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "There is an error." }],
			};
			state.triggeredRules.clear();
			expect(simulateMessageEnd(state, [rule], msg2).warnings).toHaveLength(0);
		});

		it("disabled 规则不触发", () => {
			const disabledRule: SimMessageEndRule = {
				...RULE_ENGLISH,
				enabled: false,
			};
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "I will do it." }],
			};
			const result = simulateMessageEnd(state, [disabledRule], msg);
			expect(result.warnings).toHaveLength(0);
		});

		it("aborted 状态不触发", () => {
			state.aborted = true;
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "I will do it." }],
			};
			const result = simulateMessageEnd(state, [RULE_ENGLISH], msg);
			expect(result.warnings).toHaveLength(0);
		});

		it("同一规则不重复触发", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "I will do it." }],
			};
			const r1 = simulateMessageEnd(state, [RULE_ENGLISH], msg);
			expect(r1.warnings).toHaveLength(1);
			// 第二条消息也匹配，但已触发过
			const msg2: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "Let me check again." }],
			};
			const r2 = simulateMessageEnd(state, [RULE_ENGLISH], msg2);
			expect(r2.warnings).toHaveLength(0);
		});

		it("多条规则同时触发", () => {
			const msg: SimAssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "I will fix the TODO in the code." }],
			};
			const result = simulateMessageEnd(state, [RULE_ENGLISH, RULE_STEER], msg);
			expect(result.warnings).toHaveLength(1);
			expect(result.hints).toHaveLength(1);
		});
	});
});
