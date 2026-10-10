/**
 * session_compact 集成测试 — handler 行为
 *
 * 验证：三种 reason 触发、无条件/conditions/pattern 匹配、
 * enabled/subagent 跳过、无规则空转、多次压缩多次提醒。
 * （validateRule 部分见 compaction-validate.test.ts）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@pi-atelier/shepherd";
import {
	makeCtx,
	makeMockPi,
	mockHints,
	mockIsSubagent,
	mockLoadRules,
} from "./helpers/message-end-helper";

/** 构造 session_compact 规则（真实 Rule 类型） */
function makeCompactRules(
	arr: Array<{
		comment?: string;
		conditions?: { field: string; pattern: string; negate?: boolean }[];
		pattern?: string;
		action?: string;
		reason?: string;
		enabled?: boolean;
		subagent?: boolean;
	}>,
): Rule[] {
	return arr.map((r, i) => ({
		hook: "session_compact" as const,
		comment: r.comment ?? `compact-${i}`,
		action: (r.action ?? "steer") as "steer" | "notify",
		reason: r.reason ?? "技能正文已挥发",
		enabled: r.enabled,
		subagent: r.subagent,
		pattern: r.pattern,
		flags: r.pattern ? "" : undefined,
		_compiled: r.pattern ? new RegExp(r.pattern) : undefined,
		conditions: r.conditions
			? r.conditions.map((c) => ({
					...c,
					_compiled: new RegExp(c.pattern),
				}))
			: undefined,
	})) as Rule[];
}

/** 触发 session_compact 事件 */
async function fireSessionCompact(
	handlers: Map<string, Function[]>,
	reason: "manual" | "threshold" | "overflow",
	willRetry = false,
) {
	const hs = handlers.get("session_compact");
	expect(hs).toBeDefined();
	for (const h of hs!) {
		await h({ type: "session_compact", reason, willRetry }, makeCtx());
	}
}

describe("session_compact — 集成测试", () => {
	let shepherdExtension: (pi: ExtensionAPI) => void;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockHints.length = 0;
		mockLoadRules.mockReturnValue([]);
		mockIsSubagent.mockReturnValue(false);
		vi.useFakeTimers();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		shepherdExtension(pi as unknown as ExtensionAPI);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("注册了 session_compact handler", () => {
		expect(pi._handlers.has("session_compact")).toBe(true);
	});

	it("三种 reason 均触发无条件规则", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([{ comment: "always", reason: "正文挥发" }]),
		);
		for (const reason of ["manual", "threshold", "overflow"] as const) {
			mockHints.length = 0;
			await fireSessionCompact(pi._handlers, reason);
			expect(mockHints).toHaveLength(1);
			expect(mockHints[0]?.text).toContain("正文挥发");
		}
	});

	it("无规则时零开销（空转）", async () => {
		mockLoadRules.mockReturnValue([]);
		await fireSessionCompact(pi._handlers, "threshold");
		expect(mockHints).toHaveLength(0);
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it("enabled: false 跳过", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([{ enabled: false }]),
		);
		await fireSessionCompact(pi._handlers, "threshold");
		expect(mockHints).toHaveLength(0);
	});

	it("子代理默认跳过，显式 subagent: true 才触发", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([{ comment: "default" }, { comment: "allow", subagent: true }]),
		);
		mockIsSubagent.mockReturnValue(true);
		await fireSessionCompact(pi._handlers, "threshold");
		// 只有显式 subagent: true 的规则触发
		expect(mockHints).toHaveLength(1);
		expect(mockHints[0]?.label).toBe("allow");
	});

	it("conditions field reason 过滤：manual 不触发，threshold 触发", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([
				{
					comment: "silent-only",
					conditions: [{ field: "reason", pattern: "threshold|overflow" }],
				},
			]),
		);
		await fireSessionCompact(pi._handlers, "manual");
		expect(mockHints).toHaveLength(0);
		await fireSessionCompact(pi._handlers, "threshold");
		expect(mockHints).toHaveLength(1);
		expect(mockHints[0]?.label).toBe("silent-only");
	});

	it("单条件 pattern 模式匹配 reason", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([{ comment: "pattern-mode", pattern: "^overflow$" }]),
		);
		await fireSessionCompact(pi._handlers, "threshold");
		expect(mockHints).toHaveLength(0);
		await fireSessionCompact(pi._handlers, "overflow", true);
		expect(mockHints).toHaveLength(1);
	});

	it("多次压缩多次提醒（不做每会话一次去重）", async () => {
		mockLoadRules.mockReturnValue(
			makeCompactRules([{ comment: "multi" }]),
		);
		await fireSessionCompact(pi._handlers, "threshold");
		await fireSessionCompact(pi._handlers, "threshold");
		await fireSessionCompact(pi._handlers, "overflow");
		expect(mockHints).toHaveLength(3);
	});

	it("不 sendMessage(triggerTurn)——由下一 provider request 消费", async () => {
		mockLoadRules.mockReturnValue(makeCompactRules([{ comment: "no-turn" }]));
		await fireSessionCompact(pi._handlers, "threshold");
		expect(mockHints).toHaveLength(1);
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});
});
