/**
 * tool-hooks.ts 测试 — registerToolResult
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerToolResult } from "../shepherd/tool-hooks";

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

describe("registerToolResult", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeToolState();
		pi = makePi();
	});

	it("应该注册 tool_result 事件", () => {
		registerToolResult(pi as any, state);
		expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
	});

	it("edit 工具应调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "edit",
			input: { path: "/tmp/test.ts" },
			content: [{ type: "text", text: "OK" }],
		});
		expect(mockedCheckLineCount).toHaveBeenCalledWith("/tmp/test.ts");
	});

	it("write 工具应调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "write",
			input: { path: "/tmp/new.ts" },
			content: [{ type: "text", text: "OK" }],
		});
		expect(mockedCheckLineCount).toHaveBeenCalledWith("/tmp/new.ts");
	});

	it("memory_update 应从 result 文本提取路径并调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "memory_update",
			input: {},
			content: [{ type: "text", text: "已写入 `memory/test.md` 文件" }],
		});
		expect(mockedCheckLineCount).toHaveBeenCalledWith("memory/test.md");
	});

	it("非 edit/write/memory_update 不调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "bash",
			input: { command: "ls" },
			content: [{ type: "text", text: "file1.ts\nfile2.ts" }],
		});
		expect(mockedCheckLineCount).not.toHaveBeenCalled();
	});

	it("steer 规则应调用 pushWarning 并 markTriggered", async () => {
		const tracker = state.tracker as any;
		tracker.matches.mockReturnValue(true);

		mockedLoadRules.mockReturnValue([
			{
				hook: "tool_result",
				action: "steer",
				reason: "已编辑 {count} 次",
				comment: "edit-steer",
				conditions: [{ field: "path", pattern: ".*\\.ts" }],
				requiresTools: [],
				state: { gte: 1, tools: ["edit"] },
			},
		]);
		mockedGetMatchTargets.mockReturnValue({ path: "foo.ts", text: "" });
		mockedRuleMatches.mockReturnValue(true);

		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "edit",
			input: { path: "foo.ts" },
			content: [{ type: "text", text: "OK" }],
		});

		expect(mockedPushWarning).toHaveBeenCalledWith(
			"已编辑 0 次",
			"edit-steer",
		);
		expect(state.tracker.markTriggered).toHaveBeenCalledWith("edit-steer");
	});

	it("tracker.update 应被调用记录工具结果", async () => {
		registerToolResult(pi as any, state);
		const handler = pi.handlers["tool_result"];

		await handler({
			toolName: "bash",
			input: { command: "ls" },
			content: [{ type: "text", text: "hello world" }],
			isError: false,
		});

		expect(state.tracker.update).toHaveBeenCalledWith(
			"bash",
			"hello world".length,
			false,
		);
	});
});
