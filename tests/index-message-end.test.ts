/**
 * message_end 集成测试 — 基本功能
 *
 * 验证核心匹配逻辑：正则触发、不触发、action 类型、跳过条件。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	fireMessageEnd,
	makeAssistantMessage,
	makeMockPi,
	makeMsgEndRules,
	mockHints,
	mockIsSubagent,
	mockLoadRules,
	mockPushHint,
	mockUiNotify,
} from "./helpers/message-end-helper";

describe("message_end — 集成测试（基本功能）", () => {
	let shepherdExtension: (pi: ReturnType<typeof makeMockPi>) => void;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockHints.length = 0;
		mockLoadRules.mockReturnValue([]);
		mockIsSubagent.mockReturnValue(false);
		vi.useFakeTimers();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		shepherdExtension(pi);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("注册了 message_end handler", () => {
		expect(pi._handlers.has("message_end")).toBe(true);
	});

	it("英文回复触发 notify", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "lang-check",
					conditions: [{ field: "text", pattern: "\\b(I will|Let me)\\b" }],
					action: "notify",
					reason: "检测到英文回复",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["I will fix the bug now."]),
		);

		// notify 不再走 pushWarning，改为 UI 通知
		expect(mockUiNotify).toHaveBeenCalledWith(
			expect.stringContaining("检测到英文回复"),
			"warning",
		);
	});

	it("中文回复不触发", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "lang-check",
					conditions: [{ field: "text", pattern: "\\b(I will|Let me)\\b" }],
					reason: "检测到英文回复",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["我来修复这个 bug。"]),
		);

		expect(mockPushHint).not.toHaveBeenCalled();
	});

	it("steer action 也调用 pushWarning", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "todo-check",
					conditions: [{ field: "text", pattern: "TODO|FIXME" }],
					action: "steer",
					reason: "发现 TODO，建议追踪",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["代码里有 TODO 需要处理"]),
		);

		expect(mockPushHint).toHaveBeenCalledWith(
			expect.stringContaining("发现 TODO"),
			"todo-check",
		);
	});

	it("非 assistant 消息跳过", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					conditions: [{ field: "text", pattern: ".*" }],
					reason: "应该不触发",
				},
			]),
		);

		await fireMessageEnd(pi._handlers, {
			role: "user",
			content: [{ type: "text", text: "I will do it" }],
		});

		expect(mockPushHint).not.toHaveBeenCalled();
	});

	it("无 message_end 规则时跳过", async () => {
		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["I will do something"]),
		);

		expect(mockPushHint).not.toHaveBeenCalled();
	});

	it("disabled 规则不触发", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "disabled-rule",
					conditions: [{ field: "text", pattern: ".*" }],
					reason: "应该不触发",
					enabled: false,
				},
			]),
		);

		await fireMessageEnd(pi._handlers, makeAssistantMessage(["任何内容"]));

		expect(mockPushHint).not.toHaveBeenCalled();
	});

	it("混合 text 和 tool_use blocks 只匹配文本", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "text-only",
					conditions: [{ field: "text", pattern: "hello" }],
					reason: "找到 hello",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(
				["Let me say hello"],
				[{ id: "1", name: "bash", input: { command: "echo hello" } }],
			),
		);

		// notify 不再走 pushWarning，改为 UI 通知
		expect(mockUiNotify).toHaveBeenCalledWith(
			expect.stringContaining("找到 hello"),
			"warning",
		);
	});

	it("空文本不触发", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "any-text",
					conditions: [{ field: "text", pattern: ".*" }],
					reason: "不应该触发",
				},
			]),
		);

		await fireMessageEnd(pi._handlers, {
			role: "assistant",
			content: [],
		});

		expect(mockPushHint).not.toHaveBeenCalled();
	});

	it("子代理时跳过 subagent=false 的规则", async () => {
		mockIsSubagent.mockReturnValue(true);
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					conditions: [{ field: "text", pattern: ".*" }],
					reason: "子代理不应该触发",
					subagent: false,
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["I will do something"]),
		);

		expect(mockPushHint).not.toHaveBeenCalled();
	});
});
