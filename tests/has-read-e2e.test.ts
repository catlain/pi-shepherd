/**
 * has_read 集成测试 — tool_result 记录链 + tool_call 端到端
 * （读前提醒 / 读后静音 / --help 静默）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateTracker } from "../shepherd/state-tracker";
import { registerToolCall, registerToolResult } from "../shepherd/tool-hooks";
import { createMockPi } from "./helpers/tool-hooks-mock";

// —— mock rules.js（loadRules/toolMatches/isSubagent），保留真 rules-match 求值链 ——
const { mockedLoadRules, mockedPushWarning } = vi.hoisted(() => ({
	mockedLoadRules: vi.fn((): any[] => []),
	mockedPushWarning: vi.fn(),
}));

vi.mock("../shepherd/rules.js", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("../shepherd/rules.js")
	>();
	return {
		...actual,
		loadRules: mockedLoadRules,
		toolMatches: (ruleTool: string | undefined, eventTool: string) => {
			if (!ruleTool) return true;
			return ruleTool
				.split("|")
				.map((t: string) => t.trim())
				.includes(eventTool);
		},
		isSubagent: () => false,
		isRtkAvailable: false,
	};
});

vi.mock("../shepherd/ephemeral.js", () => ({
	pushWarning: mockedPushWarning,
}));

vi.mock("../shepherd/line-count.js", () => ({
	checkLineCount: vi.fn(),
}));

/** 构造已编译形态的规则（模拟 loadRules→compileRules 产物：条件带 _compiled） */
function makeCompiledRule(): any {
	const cmdRe = new RegExp(
		"(analyze_factors|precompute_factors)\\b(?![^|;&]*(?:--help|-h\\b))",
	);
	const skillRe = new RegExp("factor-optimizer");
	return {
		comment: "[quant] factor-optimizer 操作前查技能",
		enabled: true,
		hook: "tool_call",
		tool: "bash",
		action: "notify",
		reason: "⚠ 执行前确认已读 .pi/skills/factor-optimizer/SKILL.md",
		conditions: [
			{
				field: "command",
				pattern: "(analyze_factors|precompute_factors)\\b(?![^|;&]*(?:--help|-h\\b))",
				_compiled: cmdRe,
			},
			{
				builtin: "has_read",
				pattern: "factor-optimizer",
				negate: true,
				_compiled: skillRe,
			},
		],
	};
}

/** 真实 StateTracker 的 state（端到端用，跟踪逻辑不 mock） */
function makeRealTrackerState(): any {
	return { hasEdits: false, tracker: new StateTracker(), cachedTools: null };
}

describe("registerToolResult — read 成功记录链", () => {
	let state: any;
	let pi: any;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeRealTrackerState();
		pi = createMockPi();
	});

	it("read 成功 → 记入 readPaths", async () => {
		registerToolResult(pi, state);
		await pi.handlers.tool_result({
			toolName: "read",
			input: { path: ".pi/skills/factor-optimizer/SKILL.md" },
			content: [{ type: "text", text: "..." }],
		});
		expect(state.tracker.getReadPaths()).toContain(
			".pi/skills/factor-optimizer/SKILL.md",
		);
	});

	it("read 失败（isError）→ 不记录", async () => {
		registerToolResult(pi, state);
		await pi.handlers.tool_result({
			toolName: "read",
			input: { path: "nonexistent.md" },
			content: [{ type: "text", text: "File not found" }],
			isError: true,
		});
		expect(state.tracker.getReadPaths()).toEqual([]);
	});

	it("非 read 工具（bash cat）→ 不记录", async () => {
		registerToolResult(pi, state);
		await pi.handlers.tool_result({
			toolName: "bash",
			input: { command: "cat .pi/skills/factor-optimizer/SKILL.md" },
			content: [{ type: "text", text: "..." }],
		});
		expect(state.tracker.getReadPaths()).toEqual([]);
	});
});

describe("端到端 — tool_call 读前提醒 / 读后静音", () => {
	let state: any;
	let pi: any;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeRealTrackerState();
		pi = createMockPi();
		mockedLoadRules.mockReturnValue([makeCompiledRule()]);
		registerToolCall(pi, state);
	});

	it("读前：命令命中 + 未读过 → notify 触发", async () => {
		await pi.handlers.tool_call({
			toolName: "bash",
			input: {
				command: "uv run python scripts/analyze_factors.py --config x.json",
			},
		});
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
	});

	it("读后：read 技能文件 → 同命令静音", async () => {
		state.tracker.addReadPath(".pi/skills/factor-optimizer/SKILL.md");
		await pi.handlers.tool_call({
			toolName: "bash",
			input: {
				command: "uv run python scripts/analyze_factors.py --config x.json",
			},
		});
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("--help 变体：命令条件不命中 → 静默（与已读无关）", async () => {
		await pi.handlers.tool_call({
			toolName: "bash",
			input: { command: "uv run python scripts/analyze_factors.py --help" },
		});
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});
});
