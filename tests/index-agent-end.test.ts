/**
 * index.ts 测试 — agent_end（基础场景）
 */

import {
	describe,
	it,
	expect,
	vi,
	beforeEach,
	afterEach,
} from "vitest";

const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) =>
		mockGetEffectiveConfig(...args),
}));

const mockHasWarnings = vi.fn().mockReturnValue(false);
const mockIsSubagent = vi.fn().mockReturnValue(false);
const mockLoadRules = vi.fn().mockReturnValue([]);
const mockPushWarning = vi.fn();

vi.mock("../shepherd", () => ({
	checkWorktrees: vi.fn(),
	drainHints: vi.fn().mockReturnValue(""),
	hasGitUncommittedChanges: vi.fn().mockReturnValue(false),
	hasWarnings: mockHasWarnings,
	isSubagent: mockIsSubagent,
	loadRules: mockLoadRules,
	notifySummary: vi
		.fn()
		.mockImplementation((text: string) => (text ? `📋 ${text}` : "")),
	pushWarning: mockPushWarning,
	registerToolCall: vi.fn(),
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

async function fireAgentEnd(
	handlers: Map<string, Function[]>,
	event: unknown,
	ctx?: unknown,
) {
	const hs = handlers.get("agent_end")!;
	for (const h of hs) await h(event, ctx ?? {});
}

describe("agent_end — 基础场景", () => {
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

	it("子代理时跳过", async () => {
		mockIsSubagent.mockReturnValue(true);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mockLoadRules).not.toHaveBeenCalled();
	});

	it("已中断则跳过", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		const agentStartHs = pi._handlers.get("agent_start")!;
		for (const h of agentStartHs) await h({}, { signal: ctrl.signal });

		mockIsSubagent.mockReturnValue(false);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mockLoadRules).not.toHaveBeenCalled();
	});

	it("无 agent_end 规则时跳过", async () => {
		mockLoadRules.mockReturnValue([]);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("stopReason 不匹配时跳过", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ stopReason: ["end_turn"] }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("stopReason 匹配时触发", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ stopReason: ["stop"] }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith("test reason", "test-rule");
	});

	it("默认 stopReason 为 ['stop']", async () => {
		mockLoadRules.mockReturnValue(makeRules([{}]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalled();
	});

	it("重复 comment 不触发两次", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ comment: "same-rule" }]));
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledTimes(1);

		mockPushWarning.mockClear();
		await fire(makeEvent("stop"));
		expect(mockPushWarning).not.toHaveBeenCalled();
	});

	it("不同 comment 各自触发", async () => {
		mockLoadRules.mockReturnValue(
			makeRules([
				{ comment: "r1", reason: "first" },
				{ comment: "r2", reason: "second" },
			]),
		);
		await fire(makeEvent("stop"));
		expect(mockPushWarning).toHaveBeenCalledWith("first", "r1");
		expect(mockPushWarning).toHaveBeenCalledWith("second", "r2");
		expect(mockPushWarning).toHaveBeenCalledTimes(2);
	});

	it("无 stopReason 的 assistant 视为空串，若规则允许空串则匹配", async () => {
		mockLoadRules.mockReturnValue(makeRules([{ stopReason: [""] }]));
		await fire({
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "ok" },
			],
		});
		expect(mockPushWarning).toHaveBeenCalled();
	});
});

function makeEvent(stopReason = "stop") {
	return {
		messages: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "ok", stopReason },
		],
	};
}
