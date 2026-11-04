/**
 * index-*.test.ts 共享 mock 层 — mock fn + vi.mock 工厂 + mock pi/事件辅助。
 * 与 message-end-helper.ts 并行：本文件服务 agent_end/index 装配系测试。
 * 用法：vi.mock("../shepherd", async (importOriginal) =>
 *   (await import("./helpers/shared-mocks")).barrelFactory(await importOriginal()));
 * 注意：mocks 跨用例持久——vi.clearAllMocks() 清 calls 不清 implementation，
 * 用例内 mockReturnValue 设定的值会延续到后续用例，需要时显式恢复。
 */
import { vi } from "vitest";

// mocks 钉在 globalThis：vi.resetModules() 会让 mock factory 重跑、shared-mocks 被重载为新实例，
// 若不钉住会出现「测试文件断言旧实例、handler 调新实例」的引用分家（fork-dual-module-instance 同款问题）
function createMocks() {
	return {
		checkWorktrees: vi.fn().mockResolvedValue(undefined),
		contextRestore: { enabled: true, maxTokens: 40000 } as const,
		drainHints: vi.fn().mockReturnValue(""),
		getEffectiveConfig: vi.fn().mockReturnValue({
			config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
			sources: {},
		}),
		hasGitUncommittedChanges: vi.fn().mockReturnValue(false),
		hasGitUntracked: vi.fn().mockReturnValue(false),
		hasWarnings: vi.fn().mockReturnValue(false),
		isSubagent: vi.fn().mockReturnValue(false),
		loadRules: vi.fn().mockReturnValue([]),
		notifySummary: vi.fn().mockImplementation((text: string) => (text ? `📋 ${text}` : "")),
		pushWarning: vi.fn(),
		registerCompactConfigCommand: vi.fn(),
		registerMessageEnd: vi.fn(),
		registerSessionCompact: vi.fn(),
		registerToolCall: vi.fn(),
		registerToolResult: vi.fn(),
		StateTracker: vi.fn(() => ({})),
	};
}

const g = globalThis as { __shepherdSharedMocks?: ReturnType<typeof createMocks> };

// ── mock fn 全家桶（默认行为即"无规则/无警告/非子代理"的安全基线；跨用例持久单例） ──
export const mocks = (g.__shepherdSharedMocks ??= createMocks());

// ── vi.mock 工厂（返回值供 vi.mock(path, async () => factory()) 使用） ──

/** "../shepherd" barrel — partial：真实导出打底（含 registerAgentHooks/registerHintInjector
 *  从 index.ts 直 import，不经 barrel）+ 行为控制项覆盖。actual 由测试文件 vi.mock 的
 *  importOriginal() 传入——豁免通道必须在 vitest 工厂上下文调用，普通动态 import 会被 mock 自身拦截 */
export function barrelFactory(actual: Record<string, unknown>) {
	return {
		...actual,
		checkWorktrees: mocks.checkWorktrees,
		DEFAULT_CONTEXT_RESTORE: mocks.contextRestore,
		drainHints: mocks.drainHints,
		hasGitUncommittedChanges: mocks.hasGitUncommittedChanges,
		hasGitUntracked: mocks.hasGitUntracked,
		hasWarnings: mocks.hasWarnings,
		isSubagent: mocks.isSubagent,
		loadRules: mocks.loadRules,
		notifySummary: mocks.notifySummary,
		pushWarning: mocks.pushWarning,
		registerCompactConfigCommand: mocks.registerCompactConfigCommand,
		registerMessageEnd: mocks.registerMessageEnd,
		registerSessionCompact: mocks.registerSessionCompact,
		registerToolCall: mocks.registerToolCall,
		registerToolResult: mocks.registerToolResult,
		resetMessageEndState: vi.fn(),
		StateTracker: mocks.StateTracker,
	};
}

/** "../shepherd/rules" — partial：真实 ruleMatches/isQuestionEnding 保留，load 系覆盖（actual 传入） */
export function rulesFactory(actual: Record<string, unknown>) {
	return {
		...actual,
		hasGitUncommittedChanges: mocks.hasGitUncommittedChanges,
		hasGitUntracked: mocks.hasGitUntracked,
		isSubagent: mocks.isSubagent,
		loadRules: mocks.loadRules,
	};
}

/** "../shepherd/ephemeral" — partial：真实实现打底，warning 系覆盖（actual 传入） */
export function ephemeralFactory(actual: Record<string, unknown>) {
	return {
		...actual,
		hasWarnings: mocks.hasWarnings,
		notifySummary: mocks.notifySummary,
		pushWarning: mocks.pushWarning,
	};
}

export function ephemeralSharedFactory(actual: Record<string, unknown>) {
	return { ...actual, drainHints: mocks.drainHints };
}

export function rulesToolFactory() {
	return { registerRulesEditorTool: vi.fn() };
}

/** "@pi-atelier/shared-utils" — 纯 stub（getEffectiveConfig 可控） */
export function sharedUtilsFactory() {
	return { getEffectiveConfig: mocks.getEffectiveConfig };
}

// ── mock pi 与事件辅助 ──

/** mock ExtensionAPI：收集 pi.on handler（_handlers）与 pi.events.on handler（_systemEvents） */
export function makeMockPi() {
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

/** 取某事件首个注册 handler（不存在即抛错） */
export function getHandler(pi: ReturnType<typeof makeMockPi>, event: string): Function {
	const hs = pi._handlers.get(event);
	if (!hs || hs.length === 0) throw new Error(`No handler for "${event}"`);
	return hs[0];
}

/** 触发 pi.events.on 注册的系统事件（如 ephemeral:hint） */
export function fireSystemEvent(
	pi: ReturnType<typeof makeMockPi>,
	event: string,
	data: unknown = {},
) {
	const hs = pi._systemEvents.get(event);
	if (!hs || hs.length === 0) throw new Error(`System event "${event}" has no handlers`);
	for (const h of hs) h(data);
}

/** 构造 agent_end 事件（默认 stopReason="stop" 的完整对话） */
export function makeEvent(stopReason = "stop") {
	return {
		messages: [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "ok", stopReason },
		],
	};
}

/** 构造 agent_end 规则数组（默认 comment/reason/stopReason，check 默认 always） */
export function makeRules(arr: Array<Partial<Record<string, unknown>>>) {
	return arr.map(({ check, ...rest }) => {
		const base: Record<string, unknown> = {
			hook: "agent_end",
			action: "notify",
			comment: "test-rule",
			reason: "test reason",
			stopReason: ["stop"],
		};
		const resolvedCheck = check ?? "always";
		if (resolvedCheck && !(rest as Record<string, unknown>).conditions)
			base.conditions = [{ builtin: resolvedCheck }];
		return { ...base, ...rest };
	});
}

/** 顺序 await 全部 agent_end handler */
export async function fireAgentEnd(
	handlers: Map<string, Function[]>,
	event: unknown,
	ctx?: unknown,
) {
	const hs = handlers.get("agent_end")!;
	for (const h of hs) await h(event, ctx ?? {});
}

/** 构造 session_shutdown 规则数组 */
export function shutdownRules(arr: Array<Partial<Record<string, unknown>>>) {
	return arr.map(({ check, ...rest }) => {
		const base: Record<string, unknown> = {
			hook: "session_shutdown",
			action: "notify",
			comment: "shutdown-rule",
			reason: "default reason",
		};
		const resolvedCheck = check ?? "always";
		if (resolvedCheck && !(rest as Record<string, unknown>).conditions)
			base.conditions = [{ builtin: resolvedCheck }];
		return { ...base, ...rest };
	});
}
