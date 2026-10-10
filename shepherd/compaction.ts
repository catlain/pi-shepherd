/**
 * session_compact hook 处理逻辑
 *
 * pi 会话压缩完成后（manual /compact、threshold 阈值、overflow 溢出恢复），
 * 按 `hook: "session_compact"` 规则注入提醒（典型用途：技能正文已随压缩
 * 挥发，提示 AI 需要时重读 SKILL.md）。
 *
 * 注入走 ephemeral 管线（pushWarning → 缓冲区 → before_provider_request
 * drainHints 消费即焚）。不 sendMessage(triggerTurn)：三种 reason 的压缩
 * 之后均必然存在下一个 provider request（overflow→willRetry 自动重试；
 * manual/threshold→用户下一条消息）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pushWarning } from "./ephemeral.js";
import {
	isSubagent,
	type LoadRulesOptions,
	loadRules,
	ruleMatches,
} from "./rules.js";
import type { ToolState } from "./tool-hooks.js";
import { toolsAvailable } from "./tool-hooks.js";

/**
 * 注册 session_compact 事件处理。
 *
 * 触发语义：一次压缩事件 = 一次真实挥发 = 一次提醒（不做每会话一次的
 * _fired 去重——与 message_end 的"每轮一次"语义刻意不同）。
 */
export function registerSessionCompact(
	pi: ExtensionAPI,
	state: ToolState,
	rulesDir?: string,
	rulesOptions?: LoadRulesOptions,
): void {
	pi.on("session_compact", async (event, _ctx) => {
		const rules = loadRules(rulesDir, rulesOptions).filter(
			(r) => r.hook === "session_compact",
		);
		if (rules.length === 0) return;

		// 匹配目标：reason 为压缩触发源（manual/threshold/overflow）
		const reason: string = event.reason ?? "";
		const targets = {
			text: "",
			path: "",
			command: "",
			glob: "",
			result: "",
			reason,
		};

		for (const rule of rules) {
			// 跳过禁用规则
			if (rule.enabled === false) continue;
			// 子代理控制：默认跳过，显式 subagent: true 才在子代理触发
			if (isSubagent() && rule.subagent !== true) continue;
			// 工具依赖检查
			if (!toolsAvailable(rule, pi, state)) continue;

			// 条件匹配：conditions 模式（field 可为 reason 等）；
			// 单条件 pattern 模式匹配 reason（向后兼容风格）；
			// 都没有 = 无条件触发
			if (rule.conditions && rule.conditions.length > 0) {
				if (!ruleMatches(rule, targets, undefined)) continue;
			} else if (rule.pattern) {
				const re = rule._compiled ?? new RegExp(rule.pattern, rule.flags || "");
				if (!re.test(reason)) continue;
			}

			// steer/notify 统一走 pushWarning（即焚注入）
			pushWarning(rule.reason, rule.comment);
		}
	});
}
