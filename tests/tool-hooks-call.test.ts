/**
 * tool-hooks.ts 测试 — registerToolCall + getAvailableTools/toolsAvailable
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAvailableTools,
	registerToolCall,
	toolsAvailable,
} from "../shepherd/tool-hooks";

// vi.hoisted 确保 mock 函数在 vi.mock factory 里可用
const {
	mockedLoadRules,
	mockedGetMatchTargets,
	mockedRuleMatches,
	mockedIsSubagent,
	mockedPushWarning,
	mockedCheckLineCount,
	makeToolState,
	makePi,
} = vi.hoisted(() => ({
	mockedLoadRules: vi.fn(() => []),
	mockedGetMatchTargets: vi.fn(() => ({})),
	mockedRuleMatches: vi.fn(() => false),
	mockedIsSubagent: vi.fn(() => false),
	mockedPushWarning: vi.fn(),
	mockedCheckLineCount: vi.fn(),

	makeToolState: () => ({
		hasEdits: false,
		tracker: {
			update: vi.fn(),
			resetIf: vi.fn(),
			isTriggered: vi.fn(() => false),
			nextThreshold: vi.fn((n: number) => n),
			getStats: vi.fn(() => ({ count: 0, chars: 0, errors: 0 })),
			matches: vi.fn(() => false),
			markTriggered: vi.fn(),
		},
		cachedTools: null,
	}),
	makePi: () => {
		const handlers: Record<string, Function> = {};
		return {
			handlers,
			on: vi.fn((event: string, handler: Function) => {
				handlers[event] = handler;
			}),
			getActiveTools: vi.fn(() => ["edit", "write", "bash", "read", "grep"]),
		};
	},
}));

vi.mock("../shepherd/rules.js", () => ({
	loadRules: mockedLoadRules,
	getMatchTargets: mockedGetMatchTargets,
	ruleMatches: mockedRuleMatches,
	toolMatches: (ruleTool: string | undefined, eventTool: string) => {
		if (!ruleTool) return true;
		return ruleTool.split("|").map((t: string) => t.trim()).includes(eventTool);
	},
	isSubagent: mockedIsSubagent,
	isRtkAvailable: false,
}));

vi.mock("../shepherd/ephemeral.js", () => ({
	pushWarning: mockedPushWarning,
}));

vi.mock("../shepherd/line-count.js", () => ({
	checkLineCount: mockedCheckLineCount,
}));

describe("registerToolCall", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeToolState();
		pi = makePi();
	});

	it("应该注册 tool_call 事件", () => {
		registerToolCall(pi as any, state);
		expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
	});

	it("edit/write 应该标记 hasEdits", async () => {
		registerToolCall(pi as any, state);
		const handler = pi.handlers["tool_call"];

		await handler({ toolName: "edit", input: { path: "foo.ts" } });
		expect(state.hasEdits).toBe(true);

		state.hasEdits = false;
		await handler({ toolName: "write", input: { path: "bar.ts" } });
		expect(state.hasEdits).toBe(true);
	});

	it("非 edit/write 不标记 hasEdits", async () => {
		registerToolCall(pi as any, state);
		const handler = pi.handlers["tool_call"];

		await handler({ toolName: "bash", input: { command: "ls" } });
		expect(state.hasEdits).toBe(false);
	});

	it("block 规则应该返回 block 结果", async () => {
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_call",
				tool: "edit",
				action: "block",
				reason: "禁止编辑",
				subagent: true,
				requiresTools: [],
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ path: "foo.ts", text: "" });
		mockedRuleMatches.mockReturnValue(true);

		registerToolCall(pi as any, state);
		const handler = pi.handlers["tool_call"];

		const result = await handler({ toolName: "edit", input: { path: "foo.ts" } });
		expect(result).toEqual({ block: true, reason: "⛔ shepherd: 禁止编辑" });
	});

	it("subagent=false 的规则在子代理中应跳过", async () => {
		mockedIsSubagent.mockReturnValue(true);
		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_call",
				tool: "edit",
				action: "block",
				reason: "禁止编辑",
				subagent: false,
				requiresTools: [],
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ path: "foo.ts", text: "" });
		mockedRuleMatches.mockReturnValue(true);

		registerToolCall(pi as any, state);
		const handler = pi.handlers["tool_call"];

		const result = await handler({ toolName: "edit", input: { path: "foo.ts" } });
		expect(result).toBeUndefined();
	});
});

describe("getAvailableTools & toolsAvailable", () => {
	it("第一次调用应从 pi 获取工具列表并缓存", () => {
		const state = makeToolState();
		const pi = makePi();
		const result = getAvailableTools(pi as any, state);
		expect(pi.getActiveTools).toHaveBeenCalledTimes(1);
		expect(result.has("edit")).toBe(true);

		// 第二次不调 pi
		getAvailableTools(pi as any, state);
		expect(pi.getActiveTools).toHaveBeenCalledTimes(1);
	});

	it("rule 不需要工具时 toolsAvailable 返回 true", () => {
		const state = makeToolState();
		const pi = makePi();
		expect(toolsAvailable({}, pi as any, state)).toBe(true);
		expect(toolsAvailable({ requiresTools: [] }, pi as any, state)).toBe(true);
	});

	it("rule 需要的工具不可用时返回 false", () => {
		const state = makeToolState();
		const pi = makePi();
		expect(
			toolsAvailable(
				{ requiresTools: ["edit", "nonexistent_tool"] },
				pi as any,
				state,
			),
		).toBe(false);
	});
});
