/**
 * Shepherd 规则校验逻辑
 */

import { HOOK_ACTION_SUPPORT, normalizeHook, VALID_CONDITION_FIELDS } from "./rules";

// 合法值清单由 HOOK_ACTION_SUPPORT 矩阵派生（D1 单一来源：矩阵是运行时消费分支的唯一描述，
// 校验器不再维护独立清单，杜绝「校验通过但运行时无消费分支」的双清单漂移）
export const VALID_ACTIONS: readonly string[] = [
	...new Set(Object.values(HOOK_ACTION_SUPPORT).flat()),
];
export const VALID_HOOKS: readonly string[] = Object.keys(HOOK_ACTION_SUPPORT);

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * hook × action 组合校验（独立导出，供 updateRule 分层复用）。
 * 基于运行时同源事实：hook 经 normalizeHook 归一化（缺省 = tool_call），
 * action 缺省 = block（与 compileRules 运行时默认一致）——否则无 hook/action 的规则
 * 会绕过组合校验后按运行时默认值静默失效。
 */
export function validateHookActionCombo(
	rule: Record<string, unknown>,
): string[] {
	const hook = normalizeHook(rule as { hook?: string });
	const supported = HOOK_ACTION_SUPPORT[hook];
	if (!supported) {
		return [
			`hook "${hook}" 未收录在 HOOK_ACTION_SUPPORT 矩阵（无运行时消费分支），请先在 shepherd/rules.ts 更新矩阵常量`,
		];
	}
	const action = (rule.action as string) || "block";
	if (!supported.includes(action)) {
		return [
			`hook "${hook}" 不支持 action "${action}"（支持: ${supported.join(" / ")}）——该组合无消费分支，写入后规则将静默失效`,
		];
	}
	return [];
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
	// hook × action 组合校验：仅完整模式（partial 的 update changes 缺 hook 字段时
	// 按 tool_call 判会误伤合法目标——组合由 updateRule 合并后完整校验把关）
	if (!options?.partial) {
		errors.push(...validateHookActionCombo(rule));
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
			// hook 组合校验：llmJudge 仅 message_end 支持，其他 hook 上配置会静默不生效
			// partial 模式（update changes 无 hook 字段）跳过：merged 完整校验会把关
			if (rule.hook !== undefined) {
				const hook = rule.hook as string;
				if (hook !== "message_end") {
					errors.push(
						`llmJudge 仅支持 message_end hook，当前 hook=${hook}（判断不会生效）`,
				);
				}
			}
		}
	}

	return { valid: errors.length === 0, errors };
}
