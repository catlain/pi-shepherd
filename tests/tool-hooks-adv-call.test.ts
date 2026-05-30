/**
 * tool-hooks 高级场景 — registerToolCall 未覆盖分支
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerToolCall } from "../shepherd/tool-hooks";

const { mockedLoadRules, mockedGetMatchTargets, mockedRuleMatches, mockedIsSubagent, mockedPushWarning, mockedCheckLineCount, makeToolState, makePi } = vi.hoisted(() => ({
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
			on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
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
vi.mock("../shepherd/ephemeral.js", () => ({ pushWarning: mockedPushWarning }));
vi.mock("../shepherd/line-count.js", () => ({ checkLineCount: mockedCheckLineCount }));

describe("registerToolCall — 高级", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => { vi.clearAllMocks(); state = makeToolState(); pi = makePi(); });

	it("targets 为空时不处理任何规则", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_call", tool: "bash", action: "block", reason: "test" }]);
		mockedGetMatchTargets.mockReturnValue({});
		registerToolCall(pi as any, state);
		const r = await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "git push" } });
		expect(r).toBeUndefined();
	});

	it("tool 不匹配的规则被过滤", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_call", tool: "edit", action: "block", reason: "for edit only" }]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		const r = await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
		expect(r).toBeUndefined();
	});

	it("notify action 应 pushWarning", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_call", tool: "bash", action: "notify", reason: "小心操作", comment: "alert" }]);
		mockedGetMatchTargets.mockReturnValue({ command: "rm -rf /" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "rm -rf /" } });
		expect(mockedPushWarning).toHaveBeenCalledWith("小心操作", "alert");
	});

	it("toolsAvailable 返回 false 时跳过", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_call", tool: "bash", action: "block", reason: "test", requiresTools: ["nonexistent"] }]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolCall(pi as any, state);
		const r = await pi.handlers["tool_call"]({ toolName: "bash", input: { command: "ls" } });
		expect(r).toBeUndefined();
	});
});
