/**
 * before-request-extract：判定输入提取单测
 *
 * 样本形态对齐真实 session jsonl（2026-11-06 提取实证）：
 * - user 输入：content = [{type:"text", text}]
 * - assistant 叙述：content = [thinking?, text, toolCall...]（thinking 非叙述，应排除）
 * - toolResult 续请求（jsonl 不落盘，按 pi-ai 类型构造）：user content = [toolResult]
 */

import { describe, expect, it } from "vitest";
import {
	extractLastAssistantText,
	extractLastUserText,
} from "../shepherd/before-request-extract";

// ── 真实形态样本（截取自本会话 jsonl） ──────────────────────

const realUserText = {
	role: "user",
	content: [{ type: "text", text: "Enter explore mode. Think deeply." }],
};

const realAssistantMixed = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "用户进入了 explore mode" },
		{
			type: "text",
			text: "进入了探索模式。这个想法挺有意思的——本质上是给 shepherd 加一层。",
		},
		{ type: "toolCall", id: "c1", name: "bash", arguments: {} },
		{
			type: "text",
			text: "（继续叙述第二段）",
		},
	],
};

const toolResultUser = {
	role: "user",
	content: [
		{ type: "toolResult", toolCallId: "c1", output: "ok", isError: false },
	],
};

describe("extractLastUserText", () => {
	it("尾部 user 含 text → 直接返回", () => {
		expect(extractLastUserText([realUserText])).toBe(
			"Enter explore mode. Think deeply.",
		);
	});

	it("尾部是 toolResult-only user → 跳过往前找真实用户输入", () => {
		const r = extractLastUserText([realUserText, toolResultUser]);
		expect(r).toBe("Enter explore mode. Think deeply.");
	});

	it("全部 toolResult-only → null（规则本轮跳过）", () => {
		expect(extractLastUserText([toolResultUser])).toBeNull();
	});

	it("assistant 在尾部不干扰（继续找 user）", () => {
		const r = extractLastUserText([realUserText, realAssistantMixed, toolResultUser]);
		expect(r).toBe("Enter explore mode. Think deeply.");
	});

	it("多段 text 拼接换行", () => {
		const r = extractLastUserText([
			{ role: "user", content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] },
		]);
		expect(r).toBe("第一段\n第二段");
	});

	it("messages 为 null/undefined/空数组 → null", () => {
		expect(extractLastUserText(null)).toBeNull();
		expect(extractLastUserText(undefined)).toBeNull();
		expect(extractLastUserText([])).toBeNull();
	});

	it("超 4000 字符截断", () => {
		const long = "x".repeat(5000);
		const r = extractLastUserText([
			{ role: "user", content: [{ type: "text", text: long }] },
		]);
		expect(r?.length).toBe(4000);
	});
});

describe("extractLastAssistantText", () => {
	it("尾部往前最近 assistant 的 text 拼接（thinking/toolCall 排除）", () => {
		const r = extractLastAssistantText([
			realUserText,
			realAssistantMixed,
			toolResultUser,
		]);
		expect(r).toBe(
			"进入了探索模式。这个想法挺有意思的——本质上是给 shepherd 加一层。\n（继续叙述第二段）",
		);
	});

	it("无 assistant 消息 → null", () => {
		expect(extractLastAssistantText([realUserText])).toBeNull();
	});

	it("messages 为 null/空 → null", () => {
		expect(extractLastAssistantText(null)).toBeNull();
		expect(extractLastAssistantText([])).toBeNull();
	});

	it("assistant 无 text block（纯 toolCall）→ 跳过继续往前", () => {
		const pureToolCall = {
			role: "assistant",
			content: [{ type: "toolCall", id: "c2", name: "read", arguments: {} }],
		};
		const r = extractLastAssistantText([realAssistantMixed, pureToolCall]);
		expect(r).toContain("探索模式");
	});
});
