/**
 * index.ts 测试 — session_start / session_shutdown
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

const mockCheckWorktrees = vi.fn();
const mockHasGitUncommittedChanges = vi.fn().mockReturnValue(false);
const mockLoadRules = vi.fn().mockReturnValue([]);

vi.mock("../shepherd", () => ({
	checkWorktrees: mockCheckWorktrees,
	drainHints: vi.fn().mockReturnValue(""),
	hasGitUncommittedChanges: mockHasGitUncommittedChanges,
	hasWarnings: vi.fn().mockReturnValue(false),
	isSubagent: vi.fn().mockReturnValue(false),
	loadRules: mockLoadRules,
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

function shutdownRules(
	arr: Array<{ check?: string; reason?: string }>,
) {
	return arr.map((r) => ({
		hook: "session_shutdown",
		check: "always",
		action: "notify",
		comment: "shutdown-rule",
		reason: "default reason",
		...r,
	}));
}

// ── session_start ──
describe("session_start", () => {
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

	it("应调用 checkWorktrees", async () => {
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_start")({}, ctx);
		expect(mockCheckWorktrees).toHaveBeenCalledWith(ctx.ui);
	});
});

// ── session_shutdown ──
describe("session_shutdown", () => {
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

	it("无 session_shutdown 规则时跳过", async () => {
		mockLoadRules.mockReturnValue([]);
		await getHandler(pi, "session_shutdown")({}, { ui: { notify: vi.fn() } });
		expect(mockHasGitUncommittedChanges).not.toHaveBeenCalled();
	});

	it("check=always 规则触发通知（含 ⚠️ shepherd: 前缀）", async () => {
		mockLoadRules.mockReturnValue(
			shutdownRules([{ check: "always", reason: "bye" }]),
		);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"⚠️ shepherd: bye",
			"warning",
		);
	});

	it("check=git_uncommitted 有未提交时触发（含 ⚠️ shepherd: 前缀）", async () => {
		mockLoadRules.mockReturnValue(
			shutdownRules([{ check: "git_uncommitted", reason: "git dirty" }]),
		);
		mockHasGitUncommittedChanges.mockReturnValue(true);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"⚠️ shepherd: git dirty",
			"warning",
		);
	});

	it("check=git_uncommitted 无更改时跳过", async () => {
		mockLoadRules.mockReturnValue(
			shutdownRules([{ check: "git_uncommitted", reason: "git dirty" }]),
		);
		mockHasGitUncommittedChanges.mockReturnValue(false);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("action 不为 notify 时不触发", async () => {
		const rules = shutdownRules([{ check: "always", reason: "bye" }]);
		rules[0].action = "block";
		mockLoadRules.mockReturnValue(rules);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});
});
