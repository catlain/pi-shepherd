/**
 * index.ts 测试 — agent_end check 类型
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) => mockGetEffectiveConfig(...args),
}));

const mockHasGitUncommittedChanges = vi.fn().mockReturnValue(false);
const mockHasWarnings = vi.fn().mockReturnValue(false);
const mockIsSubagent = vi.fn().mockReturnValue(false);
const mockLoadRules = vi.fn().mockReturnValue([]);
const mockPushWarning = vi.fn();
const mockRegisterToolCall = vi.fn((pi: any, toolState: any) => {
	pi.on("tool_call", () => {
		toolState.hasEdits = true;
	});
});
const mockRegisterToolResult = vi.fn();

vi.mock("../shepherd", () => ({
	checkWorktrees: vi.fn(),
	drainHints: vi.fn().mockReturnValue(""),
	hasGitUncommittedChanges: mockHasGitUncommittedChanges,
	hasGitUntracked: vi.fn().mockReturnValue(false),
	hasWarnings: mockHasWarnings,
	isSubagent: mockIsSubagent,
	loadRules: mockLoadRules,
	notifySummary: vi.fn(),
	pushWarning: mockPushWarning,
	registerToolCall: mockRegisterToolCall,
	registerToolResult: mockRegisterToolResult,
	registerMessageEnd: vi.fn(),
	resetMessageEndState: vi.fn(),
	StateTracker: vi.fn(() => ({})),
}));

vi.mock("../shepherd/rules-tool", () => ({
	registerRulesEditorTool: vi.fn(),
}));

function makeMockPi() {
	const handlers = new Map<string, Function[]>();
	return {
		on: vi.fn((event: string, handler: Function) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		}),
		events: { on: vi.fn(), emit: vi.fn() },
		sendMessage: vi.fn(),
		getActiveTools: vi.fn().mockReturnValue([]),
		_handlers: handlers,
	};
}

function makeRules(
	arr: Array<{
		check?: string;
		action?: string;
		comment?: string;
		reason?: string;
		stopReason?: string[];
		conditions?: Array<{ builtin?: string; pattern?: string; field?: string }>;
	}>,
) {
	return arr.map(({ check, ...rest }) => {
		const base: Record<string, unknown> = {
			hook: "agent_end",
			action: "notify",
			comment: "test-rule",
			reason: "test reason",
			stopReason: ["stop"],
		};
		// 兼容旧 check 字段：自动转为 conditions
		if (check === undefined || check === "always") {
			base.conditions = [{ builtin: "always" }];
		} else if (check && !rest.conditions) {
			base.conditions = [{ builtin: check }];
		} else if (rest.conditions) {
			base.conditions = rest.conditions;
			delete rest.conditions;
		}
		return { ...base, ...rest };
	});
}

function makeEvent(stopReason = "stop") {
	return {
		messages: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "ok", stopReason },
		],
	};
}

async function fireAgentEnd(handlers: Map<string, Function[]>, event: unknown) {
	const hs = handlers.get("agent_end")!;
	for (const h of hs) await h(event, {});
}

describe("agent_end — check 类型", () => {
	let shepherdExtension: (pi: ReturnType<typeof makeMockPi>) => void;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
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

	function fire(event: unknown) {
		return fireAgentEnd(pi._handlers, event);
	}

	it("check=always 触发通知", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalled();
	});

	it("check=undefined 视为 always", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: undefined }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalled();
	});

	it("action 不为 notify 时不触发", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([{ action: "block", check: "always" }]),
		);
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("check=git_dirty AND has_edits: 有更改 + 有编辑时触发", async () => {
		mockHasGitUncommittedChanges.mockReturnValue(true);
		mockLoadRules.mockReturnValue(
			makeRules([
				{
					conditions: [{ builtin: "git_dirty" }, { builtin: "has_edits" }],
					conditionLogic: "and",
					reason: "git dirty",
				},
			]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!) await h({}, {});

		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith("git dirty", "test-rule");
	});

	it("conditions git_dirty: 无更改时跳过", async () => {
		mockHasGitUncommittedChanges.mockReturnValue(false);
		mockLoadRules.mockReturnValue(makeRules([{ check: "git_uncommitted" }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("check=has_edits: 有编辑时触发", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!) await h({}, {});

		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith("edit detected", "test-rule");
	});

	it("check=has_edits: 无编辑时跳过", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	// ── 问句跳过测试 ──
	it("问句结尾时跳过 agent_end 通知", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "你觉得这个方案OK吗？", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("英文问号结尾时也跳过", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "What do you think?", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("非问句结尾时正常触发", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const normalEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "好的，已经完成修改。", stopReason: "stop" },
			],
		};
		await fire(normalEvent);
		expect(mockPushWarning).toHaveBeenCalled();
	});

	it("问句后缀模式也跳过（要不要、可以吗、你觉得）", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "这个方向你要不要试试看", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mockPushWarning).not.toHaveBeenCalled();
	});
});
