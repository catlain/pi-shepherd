/**
 * 测试辅助函数：构造 Rule 和 Condition 对象
 */

export function makeRule(overrides: Record<string, any> = {}): Record<string, any> {
	return {
		comment: "test rule",
		tool: "edit",
		action: "block",
		reason: "test reason",
		_compiled: undefined,
		...overrides,
	};
}

export function makeCondition(overrides: Record<string, any> = {}): Record<string, any> {
	return {
		field: "path",
		pattern: ".*",
		flags: "",
		_compiled: new RegExp(".*"),
		...overrides,
	};
}
