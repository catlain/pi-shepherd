/**
 * index.ts 测试 — agent_end check 类型
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) =>
		mockGetEffectiveConfig(...args),
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
	hasWarnings: mockHasWarnings,
	isSubagent: mockIsSubagent,
	loadRules: mockLoadRules,
	notifySummary: vi.fn(),
	pushWarning: mockPushWarning,
	registerToolCall: mockRegisterToolCall,
	registerToolResult: mockRegisterToolResult,
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
	}>,
) {
	return arr.map((r) => ({
		hook: "agent_end",
		check: "always",
		action: "notify",
		comment: "test-rule",
		reason: "test reason",
		stopReason: ["stop"],
		...r,
	}));
}

function makeEvent(stopReason = "stop") {
	return {
		messages: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "ok", stopReason },
		],
	};
}

async function fireAgentEnd(
	handlers: Map<string, Function[]>,
	event: unknown,
) {
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

	it("check=git_uncommitted: 有更改 + 有编辑时触发", async () => {
		mockHasGitUncommittedChanges.mockReturnValue(true);
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "git_uncommitted", reason: "git dirty" }]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!)
			await h({}, {});

		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith("git dirty", "test-rule");
	});

	it("check=git_uncommitted: 无更改时跳过", async () => {
		mockHasGitUncommittedChanges.mockReturnValue(false);
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "git_uncommitted" }]),
		);
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("check=has_edits: 有编辑时触发", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!)
			await h({}, {});

		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith(
			"edit detected",
			"test-rule",
		);
	});

	it("check=has_edits: 无编辑时跳过", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});
});
