/**
 * index.ts 测试 — before_provider_request
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 声明 ──
const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) =>
		mockGetEffectiveConfig(...args),
}));

const mockCheckWorktrees = vi.fn();
const mockDrainHints = vi.fn().mockReturnValue("");
const mockHasGitUncommittedChanges = vi.fn().mockReturnValue(false);
const mockHasWarnings = vi.fn().mockReturnValue(false);
const mockIsSubagent = vi.fn().mockReturnValue(false);
const mockLoadRules = vi.fn().mockReturnValue([]);
const mockNotifySummary = vi
	.fn()
	.mockImplementation((text: string) => (text ? `📋 ${text}` : ""));
const mockPushWarning = vi.fn();
const mockRegisterToolCall = vi.fn();
const mockRegisterToolResult = vi.fn();
const mockStateTracker = vi.fn(() => ({}));

vi.mock("../shepherd", () => ({
	checkWorktrees: mockCheckWorktrees,
	drainHints: mockDrainHints,
	hasGitUncommittedChanges: mockHasGitUncommittedChanges,
	hasWarnings: mockHasWarnings,
	isSubagent: mockIsSubagent,
	loadRules: mockLoadRules,
	notifySummary: mockNotifySummary,
	pushWarning: mockPushWarning,
	registerToolCall: mockRegisterToolCall,
	registerToolResult: mockRegisterToolResult,
	registerMessageEnd: vi.fn(),
	resetMessageEndState: vi.fn(),
	StateTracker: mockStateTracker,
}));

vi.mock("../shepherd/rules-tool", () => ({
	registerRulesEditorTool: vi.fn(),
}));

function makeMockPi() {
	const handlers = new Map<string, Function[]>();
	const systemEvents = new Map<string, Function[]>();
	return {
		on: vi.fn((event: string, handler: Function) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		}),
		events: {
			on: vi.fn((event: string, handler: Function) => {
				if (!systemEvents.has(event)) systemEvents.set(event, []);
				systemEvents.get(event)!.push(handler);
			}),
			emit: vi.fn(),
		},
		sendMessage: vi.fn(),
		getActiveTools: vi.fn().mockReturnValue([]),
		_handlers: handlers,
		_systemEvents: systemEvents,
	};
}

function fireSystemEvent(
	pi: ReturnType<typeof makeMockPi>,
	event: string,
	data: unknown = {},
) {
	const hs = pi._systemEvents.get(event);
	if (!hs) throw new Error(`No handlers for "${event}"`);
	for (const h of hs) h(data);
}

function getHandler(
	pi: ReturnType<typeof makeMockPi>,
	event: string,
): Function {
	const hs = pi._handlers.get(event);
	if (!hs || hs.length === 0) throw new Error(`No handler for "${event}"`);
	return hs[0];
}

// ── 测试 ──
describe("before_provider_request", () => {
	let shepherdExtension: (pi: ReturnType<typeof makeMockPi>) => void;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		shepherdExtension(pi);
	});

	it("有 hints 时注入到 payload 并通知", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "remember to commit" });
		mockDrainHints.mockReturnValue("");

		const payload = { messages: [{ role: "user", content: "hi" }] };
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			ctx,
		);

		expect(result).not.toBe(payload);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[1].role).toBe("user");
		expect(result.messages[1].content[0].text).toContain(
			"remember to commit",
		);
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	it("无 hints 时不修改 payload", async () => {
		mockDrainHints.mockReturnValue("");

		const payload = { messages: [{ role: "user", content: "hi" }] };
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			ctx,
		);

		expect(result.messages).toHaveLength(1);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("empty messages 时也能注入", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "test hint" });
		mockDrainHints.mockReturnValue("");

		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] as unknown[] } },
			{ ui: { notify: vi.fn() } },
		);

		expect(result.messages).toHaveLength(1);
	});

	it("drainHints 返回内容时优先添加到开头", async () => {
		mockDrainHints.mockReturnValue("shepherd steer hint");
		fireSystemEvent(pi, "ephemeral:hint", { text: "cross extension hint" });

		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [{ role: "user", content: "hi" }] } },
			ctx,
		);

		const injectedText = result.messages[1].content[0].text;
		expect(injectedText).toContain("shepherd steer hint");
		expect(injectedText).toContain("cross extension hint");
	});

	it("无 hints + 无 messages 字段返回 payload 原样", async () => {
		mockDrainHints.mockReturnValue("");
		const payload = {} as Record<string, unknown>;
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			{ ui: { notify: vi.fn() } },
		);
		expect(result.messages).toBeUndefined();
	});

	it("drainHints 空且 _localHints 空时不注入", async () => {
		mockDrainHints.mockReturnValue("");
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [{ role: "user", content: "hi" }] } },
			ctx,
		);

		expect(result.messages).toHaveLength(1);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("多次调用消耗 hints，第二次无注入", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "single use hint" });
		mockDrainHints.mockReturnValue("");

		const ctx = { ui: { notify: vi.fn() } };
		const r1 = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] } },
			ctx,
		);
		expect(r1.messages).toHaveLength(1);
		expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

		// 第二次调用 — hints 已消耗
		const r2 = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] } },
			{ ui: { notify: vi.fn() } },
		);
		expect(r2.messages).toHaveLength(0);
	});
});
