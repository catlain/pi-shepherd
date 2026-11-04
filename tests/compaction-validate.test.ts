/**
 * session_compact 规则校验测试
 *
 * 验证 validateRule 对 hook "session_compact" 与 condition
 * field "reason" 的接受与拒绝路径。
 */

import { describe, expect, it } from "vitest";
import { validateRule } from "../shepherd/rules-validate";

describe("validateRule — session_compact 与 reason 字段", () => {
	it("合法 session_compact 规则（含 reason 条件）通过校验", () => {
		const result = validateRule({
			hook: "session_compact",
			comment: "compact-skill-reminder",
			action: "steer",
			reason: "上下文文档正文已挥发",
			enabled: true,
			conditions: [{ field: "reason", pattern: "threshold|overflow" }],
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("field: reason 合法、field: unknown 拒绝", () => {
		expect(
			validateRule({
				hook: "session_compact",
				action: "steer", // 矩阵：session_compact 仅消费 steer；缺省归一化为 block 会被组合校验拒绝（防静默失效）
				conditions: [{ field: "reason", pattern: "manual" }],
				comment: "c",
				reason: "r",
			} as never).valid,
		).toBe(true);
		expect(
			validateRule({
				hook: "session_compact",
				action: "steer",
				conditions: [{ field: "nope", pattern: "x" }],
				comment: "c",
				reason: "r",
			} as never).valid,
		).toBe(false);
	});

	it("hook: session_compact 合法、未知 hook 拒绝", () => {
		expect(
			validateRule({
				hook: "session_compact",
				action: "steer",
				comment: "c",
				reason: "r",
			} as never).valid,
		).toBe(true);
		expect(
			validateRule({
				hook: "session_compact_typo",
				action: "steer",
				comment: "c",
				reason: "r",
			} as never).valid,
		).toBe(false);
	});
});
