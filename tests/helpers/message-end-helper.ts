/**
 * message_end 集成测试 — 共享 mock、辅助函数和类型
 *
 * 提供给 index-message-end.test.ts 和 index-message-end-advanced.test.ts 复用。
 */

import { expect, vi } from "vitest";

// ── 共享缓冲区 mock ──
export const mockHints: Array<{ text: string; label?: string }> = [];
export const mockPushHint = vi.fn((text: string, label?: string) => {
	mockHints.push({ text, label });
});
export const mockDrainHints = vi.fn(() => {
	const texts = mockHints.map((h) => h.text);
	mockHints.length = 0;
	return texts.join("\n");
});
export const mockHasHints = vi.fn(() => mockHints.length > 0);

export const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
	sources: {},
});

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) =>
		mockGetEffectiveConfig(...args),
	pushHint: (...args: unknown[]) => mockPushHint(...args),
	drainHints: (...args: unknown[]) => mockDrainHints(...args),
	hasHints: (...args: unknown[]) => mockHasHints(...args),
	peekHints: vi.fn(() => mockHints.map((h) => h.text)),
	peekLabels: vi.fn(() => mockHints.map((h) => h.label).filter(Boolean)),
}));

// ── 规则 mock ──
export const mockLoadRules = vi.fn().mockReturnValue([]);
export const mockIsSubagent = vi.fn().mockReturnValue(false);

vi.mock("../../shepherd/rules", async () => {
	const actual = await vi.importActual<typeof import("../../shepherd/rules")>(
		"../../shepherd/rules",
	);
	return {
		...actual,
		loadRules: (...args: unknown[]) => mockLoadRules(...args),
		isSubagent: (...args: unknown[]) => mockIsSubagent(...args),
	};
});

vi.mock("../../shepherd/rules-tool", () => ({
	registerRulesEditorTool: vi.fn(),
}));

// ── 辅助函数 ──

export function makeMockPi() {
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

export function makeAssistantMessage(
	texts: string[],
	toolCalls: Array<{
		id: string;
		name: string;
		input: Record<string, unknown>;
	}> = [],
) {
	const content: Array<Record<string, unknown>> = [
		...texts.map((t) => ({ type: "text", text: t })),
		...toolCalls.map((tc) => ({
			type: "tool_use",
			id: tc.id,
			name: tc.name,
			input: tc.input,
		})),
	];
	return { role: "assistant", content };
}

export function makeMsgEndRules(
	arr: Array<{
		comment?: string;
		conditions?: { field: string; pattern: string }[];
		action?: string;
		reason?: string;
		enabled?: boolean;
		subagent?: boolean;
	}>,
) {
	return arr.map((r, i) => ({
		hook: "message_end" as const,
		comment: r.comment ?? `msg-end-${i}`,
		action: (r.action ?? "notify") as "notify" | "steer",
		reason: r.reason ?? "test reason",
		enabled: r.enabled,
		subagent: r.subagent,
		conditions: r.conditions
			? r.conditions.map((c) => ({
					...c,
					_compiled: new RegExp(c.pattern),
				}))
			: undefined,
	}));
}

export async function fireMessageEnd(
	handlers: Map<string, Function[]>,
	message: Record<string, unknown>,
	ctx?: Record<string, unknown>,
) {
	const hs = handlers.get("message_end");
	expect(hs).toBeDefined();
	for (const h of hs!) {
		await h({ message }, ctx ?? {});
	}
}
