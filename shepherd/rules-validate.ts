/**
 * Shepherd 规则校验逻辑
 */

import { VALID_CONDITION_FIELDS } from "./rules";

const VALID_ACTIONS = ["block", "notify", "rewrite", "steer"] as const;
const VALID_HOOKS = [
	"tool_call",
	"tool_result",
	"agent_end",
	"message_end",
	"session_shutdown",
	"session_compact",
] as const;

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * 校验单条规则。
 * options.partial=true 时为增量模式（update 的 changes 严格校验）：
 * 只校验出现的字段合法性，跳过 comment/reason 必填检查。
 */
export function validateRule(
	rule: Record<string, unknown>,
	options?: { partial?: boolean },
): ValidationResult {
	const errors: string[] = [];

	// 归一化：将 disabled 转为 enabled
	if ("disabled" in rule) {
		const v = rule.disabled;
		delete rule.disabled;
		if (v === true && rule.enabled === undefined) rule.enabled = false;
		if (v === false && rule.enabled === undefined) rule.enabled = true;
	}

	if (!options?.partial) {
		if (
			!rule.comment ||
			typeof rule.comment !== "string" ||
			!rule.comment.trim()
		) {
			errors.push("缺少必填字段: comment");
		}
		if (!rule.reason || typeof rule.reason !== "string" || !rule.reason.trim()) {
			errors.push("缺少必填字段: reason");
		}
	}
	if (rule.action && !VALID_ACTIONS.includes(rule.action as any)) {
		let msg = `action 值 "${rule.action}" 不合法，可选: ${VALID_ACTIONS.join(", ")}`;
		// 常见误用：试图用 skip/disable/off 等新增规则去"关闭"某条提示。
		// action 表示规则匹配后的执行动作，不是"关闭"操作；正确做法是 update + enabled:false。
		const actionStr = String(rule.action).toLowerCase();
		if (/skip|disable|off|close|stop|mute/.test(actionStr)) {
			msg +=
				"。action 是规则匹配后的执行动作，无法用来「关闭」规则。" +
				"想临时关闭某条已存在的规则请用 update(index=N, changes={enabled:false})（保留规则，日后改 enabled:true 恢复）；彻底删除用 delete(index=N)。" +
				"操作前先 list 找到目标规则的 index。";
		}
		errors.push(msg);
	}
	if (rule.hook && !VALID_HOOKS.includes(rule.hook as any)) {
		errors.push(
			`hook 值 "${rule.hook}" 不合法，可选: ${VALID_HOOKS.join(", ")}`,
		);
	}
	if (rule.pattern) {
		try {
			new RegExp(rule.pattern as string, (rule.flags as string) || "");
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`pattern 正则编译失败: ${msg}`);
		}
	}
	if (Array.isArray(rule.conditions)) {
		for (let i = 0; i < rule.conditions.length; i++) {
			const cond = rule.conditions[i] as Record<string, unknown>;
			if (
				cond.field &&
				!(VALID_CONDITION_FIELDS as readonly string[]).includes(cond.field as string)
			) {
				errors.push(
					`conditions[${i}].field 值无效: "${cond.field}"，合法值: ${VALID_CONDITION_FIELDS.join(", ")}`,
				);
			}
			if (cond.pattern) {
				try {
					new RegExp(cond.pattern as string, (cond.flags as string) || "");
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : String(e);
					errors.push(`conditions[${i}].pattern 正则编译失败: ${msg}`);
				}
			}
		}
	}

	// llmJudge 校验：prompt 必填非空串，model 可选串，invert 可选布尔
	if (rule.llmJudge !== undefined) {
		const judge = rule.llmJudge as Record<string, unknown>;
		if (
			typeof judge !== "object" ||
			judge === null ||
			Array.isArray(judge)
		) {
			errors.push(
				"llmJudge 必须是对象（{ prompt, model?, invert? }），当前不是对象",
			);
		} else {
			if (typeof judge.prompt !== "string" || !(judge.prompt as string).trim()) {
				errors.push(
					"llmJudge.prompt 必填：非空字符串（描述“什么算命中”的判断提示词）",
			);
			}
			if (judge.model !== undefined && typeof judge.model !== "string") {
				errors.push("llmJudge.model 可选：字符串（provider/id 判断模型 ID）");
			}
			if (judge.invert !== undefined && typeof judge.invert !== "boolean") {
				errors.push("llmJudge.invert 可选：布尔（true 时答“否”才触发）");
			}
		}
	}

	return { valid: errors.length === 0, errors };
}
