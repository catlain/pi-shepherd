/**
 * tool-hooks 高级场景 — registerToolResult 未覆盖分支
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerToolResult } from "../shepherd/tool-hooks";

const { mockedLoadRules, mockedGetMatchTargets, mockedRuleMatches, mockedPushWarning, mockedCheckLineCount, makeToolState, makePi } = vi.hoisted(() => ({
	mockedLoadRules: vi.fn(() => []),
	mockedGetMatchTargets: vi.fn(() => ({})),
	mockedRuleMatches: vi.fn(() => false),
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
	isSubagent: vi.fn(() => false),
	isRtkAvailable: false,
}));
vi.mock("../shepherd/ephemeral.js", () => ({ pushWarning: mockedPushWarning }));
vi.mock("../shepherd/line-count.js", () => ({ checkLineCount: mockedCheckLineCount }));

describe("registerToolResult — 高级", () => {
	let state: ReturnType<typeof makeToolState>;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => { vi.clearAllMocks(); state = makeToolState(); pi = makePi(); });

	it("memory_update 无匹配路径时不调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({
			toolName: "memory_update", input: {},
			content: [{ type: "text", text: "无反引号路径" }],
		});
		expect(mockedCheckLineCount).not.toHaveBeenCalled();
	});

	it("edit/write 无 filePath 时不调用 checkLineCount", async () => {
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({
			toolName: "edit", input: {},
			content: [{ type: "text", text: "done" }],
		});
		expect(mockedCheckLineCount).not.toHaveBeenCalled();
	});

	it("requireSuccess + isError 跳过匹配规则", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "bash", action: "notify", reason: "出错", requireSuccess: true }]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: { command: "ls" }, content: [{ type: "text", text: "err" }], isError: true });
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("enabled===false 的规则被跳过", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "bash", action: "notify", reason: "不应触发", enabled: false }]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: { command: "ls" }, content: [{ type: "text", text: "ok" }] });
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("rule.tool 不匹配 event.toolName 时跳过", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "edit", action: "notify", reason: "只对 edit" }]);
		mockedGetMatchTargets.mockReturnValue({ path: "foo.ts" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: {}, content: [{ type: "text", text: "ok" }] });
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("notify action 应 pushWarning", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "bash", action: "notify", reason: "注意", comment: "alert" }]);
		mockedGetMatchTargets.mockReturnValue({ command: "ls" });
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: { command: "ls" }, content: [{ type: "text", text: "ok" }] });
		expect(mockedPushWarning).toHaveBeenCalledWith("注意", "alert");
	});

	it("state 条件中 isTriggered 为 true 时调用 nextThreshold", async () => {
		const tracker = state.tracker as any;
		tracker.isTriggered.mockReturnValue(true);
		tracker.matches.mockReturnValue(true);
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "bash", action: "steer", reason: "已 {count} 次", comment: "c", state: { tools: ["edit"], gte: 3 } }]);
		mockedRuleMatches.mockReturnValue(true);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: {}, content: [{ type: "text", text: "ok" }] });
		expect(tracker.nextThreshold).toHaveBeenCalled();
	});

	it("resetOn 传入 rules 和 event.toolName", async () => {
		mockedLoadRules.mockReturnValue([{ hook: "tool_result", tool: "bash", action: "notify", reason: "r", resetOn: ["bash"] }]);
		registerToolResult(pi as any, state);
		await pi.handlers["tool_result"]({ toolName: "bash", input: {}, content: [{ type: "text", text: "ok" }] });
		expect(state.tracker.resetIf).toHaveBeenCalledWith("bash", expect.any(Array));
	});
});
