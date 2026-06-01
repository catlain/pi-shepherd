/**
 * index.ts 测试 — 扩展注册、config、ephemeral:hint
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

// ── Fixture ──
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
	if (!hs || hs.length === 0)
		throw new Error(`System event "${event}" has no handlers`);
	for (const h of hs) h(data);
}

// ── 测试 ──
describe("shepherdExtension 注册 & config", () => {
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

	it("应注册所有 pi 事件", () => {
		const expected = [
			"before_provider_request",
			"session_start",
			"agent_start",
			"input",
			"agent_end",
			"session_shutdown",
		];
		for (const evt of expected) {
			expect(pi._handlers.has(evt)).toBe(true);
		}
	});

	it("应注册 ephemeral:hint 系统事件", () => {
		expect(pi._systemEvents.has("ephemeral:hint")).toBe(true);
	});

	it("应注册 tool_call/tool_result 子模块（注意：config 嵌套在 .config 下）", () => {
		expect(mockRegisterToolCall).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({ hasEdits: false, cachedTools: null }),
			expect.any(String),
			expect.objectContaining({ projectRulesPattern: undefined }),
		);
		expect(mockRegisterToolResult).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({ hasEdits: false, cachedTools: null }),
			expect.any(String),
			expect.objectContaining({ projectRulesPattern: undefined }),
		);
	});

	it("应注册 rules editor 工具", async () => {
		// registerRulesEditorTool 被 vi.mock 为 vi.fn()，验证曾调用
		const rulesToolMod = await import("../shepherd/rules-tool");
		const rulesTool = vi.mocked(rulesToolMod);
		expect(rulesTool.registerRulesEditorTool).toHaveBeenCalledWith(
			pi,
			expect.any(String), // rulesDir
			expect.any(String), // cwd
		);
	});

	it("应在注册时调用 getEffectiveConfig", () => {
		expect(mockGetEffectiveConfig).toHaveBeenCalledWith(
			"shepherd",
			{ projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
			process.cwd(),
		);
	});

	// ── ephemeral:hint ──

	describe("ephemeral:hint", () => {
		it("应缓存 hint 并可被请求消耗", async () => {
			fireSystemEvent(pi, "ephemeral:hint", {
				text: "memory hint",
				short: "hint",
			});

			mockDrainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0](
				{ payload: { messages: [] } },
				ctx,
			);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});

		it("多个 hints 合并注入", async () => {
			fireSystemEvent(pi, "ephemeral:hint", { text: "hint A" });
			fireSystemEvent(pi, "ephemeral:hint", { text: "hint B" });

			mockDrainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0]({ payload: { messages: [] } }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});

		it("hint 无 short 也能工作", async () => {
			fireSystemEvent(pi, "ephemeral:hint", {
				text: "long only",
			});
			mockDrainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0]({ payload: { messages: [] } }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});
	});
});
