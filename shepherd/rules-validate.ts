/**
 * Shepherd 规则校验逻辑
 */

const VALID_ACTIONS = ["block", "notify", "rewrite", "steer"] as const;
const VALID_HOOKS = ["tool_call", "tool_result", "agent_end", "session_shutdown"] as const;

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/** 校验单条规则 */
export function validateRule(rule: Record<string, unknown>): ValidationResult {
	const errors: string[] = [];

	if (!rule.comment || typeof rule.comment !== "string" || !rule.comment.trim()) {
		errors.push("缺少必填字段: comment");
	}
	if (!rule.reason || typeof rule.reason !== "string" || !rule.reason.trim()) {
		errors.push("缺少必填字段: reason");
	}
	if (rule.action && !VALID_ACTIONS.includes(rule.action as any)) {
		errors.push(`action 值 "${rule.action}" 不合法，可选: ${VALID_ACTIONS.join(", ")}`);
	}
	if (rule.hook && !VALID_HOOKS.includes(rule.hook as any)) {
		errors.push(`hook 值 "${rule.hook}" 不合法，可选: ${VALID_HOOKS.join(", ")}`);
	}
	if (rule.pattern) {
		try { new RegExp(rule.pattern as string, (rule.flags as string) || ""); }
		catch (e: any) { errors.push(`pattern 正则编译失败: ${e.message}`); }
	}
	if (Array.isArray(rule.conditions)) {
		for (let i = 0; i < rule.conditions.length; i++) {
			const cond = rule.conditions[i] as Record<string, unknown>;
			if (cond.pattern) {
				try { new RegExp(cond.pattern as string, (cond.flags as string) || ""); }
				catch (e: any) { errors.push(`conditions[${i}].pattern 正则编译失败: ${e.message}`); }
			}
		}
	}

	return { valid: errors.length === 0, errors };
}
