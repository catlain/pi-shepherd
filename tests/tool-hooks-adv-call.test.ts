/**
 * tool-hooks 高级场景 — registerToolCall 未覆盖分支
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerToolCall } from "../shepherd/tool-hooks";
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
		mockedGetMatchTargets.mockReturnValue({});
		registerToolCall(pi as any, state);
		const r = await pi.handlers.tool_call({
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
		const r = await pi.handlers.tool_call({
			toolName: "bash",
			input: { command: "ls" },
		});
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
		await pi.handlers.tool_call({
			toolName: "bash",
			input: { command: "rm -rf /" },
		});
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
		const r = await pi.handlers.tool_call({
			toolName: "bash",
			input: { command: "ls" },
		});
		expect(r).toBeUndefined();
	});
});
