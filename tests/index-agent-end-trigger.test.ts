/**
 * index.ts 测试 — agent_end triggerTurn / abort 信号
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
	registerToolResult: vi.fn(),
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
		const resolvedCheck = check ?? "always";
		if (resolvedCheck && !rest.conditions) {
			base.conditions = [{ builtin: resolvedCheck }];
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

async function fireAgentEnd(
	handlers: Map<string, Function[]>,
	event: unknown,
) {
	const hs = handlers.get("agent_end")!;
	for (const h of hs) await h(event, {});
}

describe("agent_end — triggerTurn / abort", () => {
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

	it("有 warnings 时发送 triggerTurn 消息", async () => {
		mockHasWarnings.mockReturnValue(true);
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "always", comment: "warn-rule" }]),
		);

		await fire(makeEvent("stop"));
		await vi.advanceTimersByTimeAsync(10);

		expect(pi.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "shepherd-agent-end",
				display: false,
			}),
			{ triggerTurn: true },
		);
	});

	it("无 warnings 时不发送 triggerTurn", async () => {
		mockHasWarnings.mockReturnValue(false);
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));

		await fire(makeEvent("stop"));
		await vi.advanceTimersByTimeAsync(10);
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it("sendMessage 抛出异常不崩溃", async () => {
		mockHasWarnings.mockReturnValue(true);
		mockLoadRules.mockReturnValue(
			makeRules([{ check: "always", comment: "warn-rule" }]),
		);
		pi.sendMessage.mockImplementation(() => {
			throw new Error("session replaced");
		});

		await fire(makeEvent("stop"));
		await vi.advanceTimersByTimeAsync(10);
	});

	it("abort 信号触发后 agent_end 跳过", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));

		const ctrl = new AbortController();
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: ctrl.signal });

		ctrl.abort();

		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("正常 agent_start → agent_end 流程", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ check: "always" }]));

		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });

		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalled();
	});
});
