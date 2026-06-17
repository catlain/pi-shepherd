/**
 * tool-hooks.ts 高级场景 — 覆盖 81.42% 之外的剩余分支
 *
 * registerToolCall 未覆盖分支：
 *   - notify action → pushWarning
 *   - rewrite action（isRtkAvailable=true → 重写 bash 命令加 rtk 前缀）
 *   - tool 不匹配的规则过滤
 *   - targets 为空时跳过
 *   - toolsAvailable 返回 false
 *
 * registerToolResult 未覆盖分支：
 *   - memory_update 无匹配路径 → 跳过 checkLineCount
 *   - requireSuccess + isError → 跳过
 *   - enabled === false → 跳过
 *   - rule.tool 不匹配 → 跳过
 *   - notify action → pushWarning
 *   - state isTriggered 为 true 时的阈值检查
 *   - resetOn 被调用
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerToolCall, registerToolResult } from "../shepherd/tool-hooks";
import {
	createMockToolState as makeToolState,
	createMockPi as makePi,
} from "./helpers/tool-hooks-mock";

const {
	mockedLoadRules,
	mockedGetMatchTargets,
	mockedRuleMatches,
	mockedIsSubagent,
	mockedPushWarning,
	mockedCheckLineCount,
} = vi.hoisted(() => ({
	mockedLoadRules: vi.fn((): any[] => []),
	mockedGetMatchTargets: vi.fn(() => ({})),
	mockedRuleMatches: vi.fn(() => false),
	mockedIsSubagent: vi.fn(() => false),
	mockedPushWarning: vi.fn(),
	mockedCheckLineCount: vi.fn(),
}));

// isRtkAvailable 不能动态 mock（模块级常量），只测试 isRtkAvailable=false 的分支
vi.mock("../shepherd/rules.js", () => ({
	loadRules: mockedLoadRules,
	getMatchTargets: mockedGetMatchTargets,
	ruleMatches: mockedRuleMatches,
	toolMatches: (ruleTool: string | undefined, eventTool: string) => {
		if (!ruleTool) return true;
		return ruleTool
			.split("|")
			.map((t: string) => t.trim())
			.includes(eventTool);
	},
	isSubagent: mockedIsSubagent,
	isRtkAvailable: false,
}));
vi.mock("../shepherd/ephemeral.js", () => ({ pushWarning: mockedPushWarning }));
vi.mock("../shepherd/line-count.js", () => ({
	checkLineCount: mockedCheckLineCount,
}));

// ── registerToolCall 高级场景 ────────────────────────────

describe("registerToolCall — 高级", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeToolState();
		pi = makePi();
	});

	it("targets 为空时不处理任何规则", async () => {
		mockedLoadRules.mockReturnValue([
			{ hook: "tool_call", tool: "bash", action: "block", reason: "test" },
		]);
		mockedGetMatchTargets.mockReturnValue({}); // 空 targets
		registerToolCall(pi as any, state);
		const handler = pi.handlers.tool_call;
		const r = await handler({
			toolName: "bash",
			input: { command: "git push" },
		});
		expect(r).toBeUndefined();
	});

	it("tool 不匹配的规则被过滤", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_call",
				tool: "edit",
				action: "block",
				reason: "for edit only",
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		const handler = pi.handlers.tool_call;
		const r = await handler({ toolName: "bash", input: { command: "ls" } });
		expect(r).toBeUndefined();
	});

	it("notify action 应 pushWarning", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_call",
				tool: "bash",
				action: "notify",
				reason: "小心操作",
				comment: "alert",
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "rm -rf /" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		const handler = pi.handlers.tool_call;
		await handler({ toolName: "bash", input: { command: "rm -rf /" } });
		expect(mockedPushWarning).toHaveBeenCalledWith("小心操作", "alert");
	});

	it("toolsAvailable 返回 false 时跳过", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_call",
				tool: "bash",
				action: "block",
				reason: "test",
				requiresTools: ["nonexistent"],
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		const handler = pi.handlers.tool_call;
		const r = await handler({ toolName: "bash", input: { command: "ls" } });
		expect(r).toBeUndefined();
	});
});

// ── registerToolResult 高级场景 ──────────────────────────

describe("registerToolResult — 高级", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeToolState();
		pi = makePi();
	});

	it("memory_update 无匹配路径时不调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "memory_update",
			input: {},
			content: [{ type: "text", text: "没有反引号路径" }],
		});
		expect(mockedCheckLineCount).not.toHaveBeenCalled();
	});

	it("edit/write 无 filePath 时不调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "edit",
			input: {},
			content: [{ type: "text", text: "done" }],
		});
		expect(mockedCheckLineCount).not.toHaveBeenCalled();
	});

	it("requireSuccess + isError 跳过匹配的规则", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "bash",
				action: "notify",
				reason: "出错",
				requireSuccess: true,
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "bash",
			input: { command: "ls" },
			content: [{ type: "text", text: "error" }],
			isError: true,
		});
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("enabled===false 的规则被跳过", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "bash",
				action: "notify",
				reason: "不应触发",
				enabled: false,
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "bash",
			input: { command: "ls" },
			content: [{ type: "text", text: "ok" }],
		});
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("rule.tool 不匹配 event.toolName 时跳过", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "edit",
				action: "notify",
				reason: "只对 edit",
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ path: "foo.ts" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "bash",
			input: {},
			content: [{ type: "text", text: "ok" }],
		});
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("notify action 应走 pushWarning 注入到 LLM payload", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "bash",
				action: "notify",
				reason: "注意",
				comment: "alert",
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler(
			{
				toolName: "bash",
				input: { command: "ls" },
				content: [{ type: "text", text: "ok" }],
			},
			{ ui: { notify: vi.fn() } },
		);
		expect(mockedPushWarning).toHaveBeenCalledWith("注意", "alert");
	});

	it("state 条件中 isTriggered 为 true 时触发 nextThreshold", async () => {
		const tracker = state.tracker as any;
		tracker.isTriggered.mockReturnValue(true);
		tracker.matches.mockReturnValue(true);

		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "bash",
				action: "steer",
				reason: "已 {count} 次",
				comment: "c",
				state: { tools: ["edit"], gte: 3 },
			},
		]);
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "bash",
			input: {},
			content: [{ type: "text", text: "ok" }],
		});
		expect(tracker.nextThreshold).toHaveBeenCalled();
	});

	it("resetOn 应传入 rules 和 event.toolName", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				tool: "bash",
				action: "notify",
				reason: "r",
				resetOn: ["bash"],
			},
		]);
		registerToolResult(pi as any, state);
		const handler = pi.handlers.tool_result;
		await handler({
			toolName: "bash",
			input: {},
			content: [{ type: "text", text: "ok" }],
		});
		expect(state.tracker.resetIf).toHaveBeenCalledWith(
			"bash",
			expect.any(Array),
		);
	});
});
