/**
 * 测试辅助函数：构造 Rule 和 Condition 对象
 */

import type { Condition, Rule } from "@pi-atelier/shepherd";

export function makeRule(overrides: Record<string, any> = {}): Rule {
	return {
		comment: "test rule",
		tool: "edit",
		action: "block",
		reason: "test reason",
		_compiled: undefined,
		...overrides,
	} as Rule;
}

export function makeCondition(overrides: Record<string, any> = {}): Condition {
	return {
		field: "path",
		pattern: ".*",
		flags: "",
		_compiled: /.*/,
		...overrides,
	} as Condition;
}
