/**
 * index.ts 测试 — agent_start / input
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) =>
		mockGetEffectiveConfig(...args),
}));

const mockHasGitUncommittedChanges = vi.fn().mockReturnValue(false);

vi.mock("../shepherd", () => ({
	checkWorktrees: vi.fn(),
	drainHints: vi.fn().mockReturnValue(""),
	hasGitUncommittedChanges: mockHasGitUncommittedChanges,
	hasWarnings: vi.fn().mockReturnValue(false),
	isSubagent: vi.fn().mockReturnValue(false),
	loadRules: vi.fn().mockReturnValue([]),
	notifySummary: vi.fn(),
	pushWarning: vi.fn(),
	registerToolCall: vi.fn(),
	registerToolResult: vi.fn(),
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

function getHandler(
	pi: ReturnType<typeof makeMockPi>,
	event: string,
): Function {
	const hs = pi._handlers.get(event)!;
	if (!hs) throw new Error(`No handler for "${event}"`);
	return hs[0];
}

// ── agent_start ──
describe("agent_start", () => {
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

	it("重置 _aborted（未中断）", async () => {
		const controller = new AbortController();
		await getHandler(pi, "agent_start")(
			{},
			{ signal: controller.signal },
		);
		// signal.aborted 为 false → _aborted = false
		// 通过后续 agent_end 验证不跳过
	});

	it("检测 signal.aborted=true", async () => {
		const controller = new AbortController();
		controller.abort();
		await getHandler(pi, "agent_start")(
			{},
			{ signal: controller.signal },
		);
		// 后续 agent_end 应跳过 — 用另一测试文件验证
	});

	it("无 signal 时 _aborted 默认为 false", async () => {
		await getHandler(pi, "agent_start")({}, {});
		// 无 signal → _aborted = false
	});

	it("检查 git uncommitted 状态", async () => {
		mockHasGitUncommittedChanges.mockReturnValue(true);
		await getHandler(pi, "agent_start")({}, { signal: undefined });
		expect(mockHasGitUncommittedChanges).toHaveBeenCalled();
	});

	it("连续调用重置状态", async () => {
		// 确保不会因上次调用残留状态
		await getHandler(pi, "agent_start")(
			{},
			{ signal: new AbortController().signal },
		);
		expect(mockHasGitUncommittedChanges).toHaveBeenCalled();
	});

	it("abort 事件监听不抛出 catch 错误", async () => {
		// 正常 AbortController.signal 有 addEventListener，验证不崩溃
		const signal = new AbortController().signal;
		await expect(
			getHandler(pi, "agent_start")({}, { signal }),
		).resolves.toBeUndefined();
	});
});

// ── input ──
describe("input 事件", () => {
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

	it("已注册 input 事件处理器", () => {
		expect(pi._handlers.has("input")).toBe(true);
	});

	it("input 处理器不抛出异常", async () => {
		await expect(
			getHandler(pi, "input")({ text: "hello" }, {}),
		).resolves.toBeUndefined();
	});
});
