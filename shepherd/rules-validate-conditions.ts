/**
 * conditions 数组校验（从 rules-validate.ts 拆分：builtin 供能矩阵 + 单条条件校验）。
 * hook × builtin 供能矩阵与 buildBuiltinContext 消费面同步维护。
 */

import { VALID_CONDITION_BUILTINS } from "./conditions";
import { VALID_CONDITION_FIELDS } from "./rules";

/**
 * hook × builtin 供能矩阵：该 hook 场景下 builtin 谓词能从 BuiltinContext 拿到数据。
 * 与 buildBuiltinContext 消费面同步维护（smell 发现 1：非供能组合校验通过但求值恒 false）。
 * git_* 仅 agent 系（组装点惰性求值 git 状态，tool 场景每次调用不划算）；
 * not_question_ending 依赖 lastAssistantText（仅 agent 系组装点提供）。
 */
const BUILTIN_HOOK_SUPPORT: Record<string, string[]> = {
	git_dirty: ["agent_end", "session_shutdown"],
	git_untracked: ["agent_end", "session_shutdown"],
	git_uncommitted: ["agent_end", "session_shutdown"],
	has_edits: [
		"tool_call",
		"tool_result",
		"message_end",
		"before_provider_request",
		"agent_end",
		"session_shutdown",
	],
	not_question_ending: ["agent_end"],
	has_read: [
		"tool_call",
		"tool_result",
		"message_end",
		"before_provider_request",
		"agent_end",
		"session_shutdown",
	],
	always: ["*"],
};

/**
 * 校验 conditions 数组：field 枚举 / builtin 枚举 / builtin×hook 供能 /
 * has_read pattern 必填 / 正则可编译。
 */
export function validateConditions(
	conditions: unknown[],
	hook: string,
	errors: string[],
): void {
	for (let i = 0; i < conditions.length; i++) {
		const cond = conditions[i] as Record<string, unknown>;
		if (
			cond.field &&
			!(VALID_CONDITION_FIELDS as readonly string[]).includes(cond.field as string)
		) {
			errors.push(
				`conditions[${i}].field 值无效: "${cond.field}"，合法值: ${VALID_CONDITION_FIELDS.join(", ")}`,
			);
		}
		// builtin 枚举校验（单一来源：VALID_CONDITION_BUILTINS）
		if (
			cond.builtin &&
			!(VALID_CONDITION_BUILTINS as readonly string[]).includes(
				cond.builtin as string,
			)
		) {
			errors.push(
				`conditions[${i}].builtin 值无效: "${cond.builtin}"，合法值: ${VALID_CONDITION_BUILTINS.join(", ")}`,
			);
		}
		// builtin × hook 供能校验：非供能组合 = 校验通过但求值恒 false（静默死规则）
		if (cond.builtin) {
			const supported = BUILTIN_HOOK_SUPPORT[cond.builtin as string];
			if (
				supported &&
				!supported.includes("*") &&
				!supported.includes(hook)
			) {
				errors.push(
					`conditions[${i}].builtin "${cond.builtin}" 在 hook "${hook}" 场景不供能（求值恒 false，规则将静默失效）；受支持 hook: ${supported.join(", ")}`,
				);
			}
		}
		// has_read 谓词的 pattern 必填（路径正则，用于匹配会话内已读路径）
		if (cond.builtin === "has_read" && !cond.pattern) {
			errors.push(
				`conditions[${i}].builtin "has_read" 必须提供 pattern（路径正则，如 "factor-optimizer"）`,
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
