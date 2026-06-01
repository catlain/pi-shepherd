/**
 * message_end 集成测试 — 高级场景
 *
 * 验证防重复触发、多条规则、steer 触发新 turn、agent_start 重置。
 */

import {
	describe,
	it,
	expect,
	vi,
	beforeEach,
	afterEach,
} from "vitest";
import {
	mockHints,
	mockPushHint,
	mockHasHints,
	mockLoadRules,
	makeMockPi,
	makeAssistantMessage,
	makeMsgEndRules,
	fireMessageEnd,
} from "./helpers/message-end-helper";

describe("message_end — 集成测试（高级场景）", () => {
	let shepherdExtension: (pi: ReturnType<typeof makeMockPi>) => void;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockHints.length = 0;
		mockLoadRules.mockReturnValue([]);
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

	it("同一规则不重复触发", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "dup-check",
					conditions: [{ field: "text", pattern: "test" }],
					reason: "第一次触发",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["this is a test message"]),
		);
		expect(mockPushHint).toHaveBeenCalledTimes(1);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["another test here"]),
		);
		expect(mockPushHint).toHaveBeenCalledTimes(1);
	});

	it("多条规则可同时触发", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "english-check",
					conditions: [{ field: "text", pattern: "\\bI will\\b" }],
					reason: "英文提醒",
				},
				{
					comment: "todo-check",
					conditions: [{ field: "text", pattern: "TODO" }],
					reason: "TODO 提醒",
				},
			]),
		);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["I will fix the TODO later"]),
		);

		expect(mockPushHint).toHaveBeenCalledTimes(2);
		expect(mockPushHint).toHaveBeenCalledWith(
			expect.stringContaining("英文提醒"),
			"english-check",
		);
		expect(mockPushHint).toHaveBeenCalledWith(
			expect.stringContaining("TODO 提醒"),
			"todo-check",
		);
	});

	it("hasWarnings 时 sendMessage 触发新 turn", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "steer-check",
					conditions: [{ field: "text", pattern: "trigger" }],
					action: "steer",
					reason: "注入提示",
				},
			]),
		);
		mockHasHints.mockImplementation(() => mockHints.length > 0);

		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["please trigger the rule"]),
		);

		vi.advanceTimersByTime(10);

		expect(pi.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "shepherd-message-end",
				display: false,
			}),
			{ triggerTurn: true },
		);
	});

	it("agent_start 重置防重复状态", async () => {
		mockLoadRules.mockReturnValue(
			makeMsgEndRules([
				{
					comment: "reset-check",
					conditions: [{ field: "text", pattern: "test" }],
					reason: "触发",
				},
			]),
		);

		// 第一次触发
		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["test message"]),
		);
		expect(mockPushHint).toHaveBeenCalledTimes(1);

		// agent_start 重置
		const hs = pi._handlers.get("agent_start");
		expect(hs).toBeDefined();
		for (const h of hs!) {
			await h({}, { signal: new AbortController().signal });
		}

		// 重置后可再次触发
		await fireMessageEnd(
			pi._handlers,
			makeAssistantMessage(["test again"]),
		);
		expect(mockPushHint).toHaveBeenCalledTimes(2);
	});
});
