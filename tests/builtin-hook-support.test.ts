/**
 * hook × builtin 供能矩阵校验测试（rules-validate-conditions）
 * 矩阵与 buildBuiltinContext 消费面同步（smell 发现 1 的防线）。
 */

import { describe, expect, it } from "vitest";
import { validateRule } from "../shepherd/rules-validate";

function condRule(hook: string, builtin: string, pattern?: string) {
	return {
		comment: "t",
		reason: "r",
		hook,
		action: "notify",
		conditions: [
			pattern
				? { builtin, pattern }
				: { builtin },
		],
	};
}

describe("builtin × hook 供能校验", () => {
	it("git_dirty 在 tool_call 不供能 → 拒绝（静默死规则防线）", () => {
		const r = validateRule(condRule("tool_call", "git_dirty"));
		expect(r.valid).toBe(false);
		expect(r.errors.some((e) => e.includes("不供能") && e.includes("git_dirty"))).toBe(
			true,
		);
		expect(r.errors.some((e) => e.includes("agent_end"))).toBe(true);
	});

	it("git_dirty 在 agent_end 供能 → 通过", () => {
		expect(validateRule(condRule("agent_end", "git_dirty")).valid).toBe(true);
	});

	it("has_read 在 tool_call/message_end/before_provider_request/agent_end 均供能（工厂统一后）", () => {
		for (const hook of [
			"tool_call",
			"message_end",
			"before_provider_request",
			"agent_end",
		]) {
			expect(validateRule(condRule(hook, "has_read", "x")).valid).toBe(true);
		}
	});

	it("not_question_ending 在 message_end 不供能（lastAssistantText 仅 agent 系组装）", () => {
		expect(validateRule(condRule("message_end", "not_question_ending")).valid).toBe(
			false,
		);
	});

	it("always 全 hook 供能", () => {
		expect(validateRule(condRule("tool_call", "always")).valid).toBe(true);
		expect(validateRule(condRule("session_shutdown", "always")).valid).toBe(true);
	});

	it("供能错误消息给出受支持 hook 清单", () => {
		const r = validateRule(condRule("message_end", "git_untracked"));
		expect(r.errors[0]).toContain("受支持 hook");
	});
});
