/**
 * session_compact hook 处理逻辑
 *
 * pi 会话压缩完成后（manual /compact、threshold 阈值、overflow 溢出恢复），
 * 按 `hook: "session_compact"` 规则注入提醒（典型用途：上下文文档正文已随压缩
 * 挥发，提示 AI 需要时重读 SKILL.md）。
 *
 * 注入走 ephemeral 管线（pushWarning → 缓冲区 → before_provider_request
 * drainHints 消费即焚）。不 sendMessage(triggerTurn)：三种 reason 的压缩
 * 之后均必然存在下一个 provider request（overflow→willRetry 自动重试；
 * manual/threshold→用户下一条消息）。
 */

import { basename, dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { pushWarning } from "./ephemeral";
import {
	buildRestoreDecision,
	getActiveDocs,
	type ContextRestoreConfig,
} from "./context-restore";
import {
	isSubagent,
	type LoadRulesOptions,
	loadRules,
	ruleMatches,
} from "./rules";
import type { ToolState } from "./tool-hooks";
import { toolsAvailable } from "./tool-hooks";

/**
 * 注册 session_compact 事件处理。
 *
 * 触发语义：一次压缩事件 = 一次真实挥发 = 一次提醒（不做每会话一次的
 * _fired 去重——与 message_end 的"每轮一次"语义刻意不同）。
 *
 * context-restore 联动（extend-context-restore）：压缩后先把激活过的
 * SKILL.md 正文持久注入（sendMessage no-trigger 分支），注入成功时提醒
 * 降级为 ui.notify；空集/关闭/失败时维持原提醒；截断名单追加点名。
 */
export function registerSessionCompact(
	pi: ExtensionAPI,
	state: ToolState,
	rulesDir?: string,
	rulesOptions?: LoadRulesOptions,
	contextRestore?: ContextRestoreConfig,
): void {
	pi.on("session_compact", async (event, ctx) => {
		// ── 恢复注入（先于提醒，联动决策依赖注入结果）──
		const restoredDocs = performContextRestore(
			pi,
			event.reason,
			contextRestore,			ctx.ui?.notify?.bind(ctx.ui),
		);

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

			// 恢复注入成功 → 跳过 steer 文本（正文已恢复，无需引导重读）
			if (restoredDocs > 0) continue;

			// steer/notify 统一走 pushWarning（即焚注入）
			pushWarning(rule.reason, rule.comment);
		}
	});
}

/**
 * 恢复注入执行体：返回成功注入的技能数。
 *
 * - contextRestore 未启用 / 子代理 → 0（维持原提醒行为）
 * - 激活集空 → 0（零注入，仅走既有提醒管线）
 * - 注入成功 ≥1 → sendMessage 持久条目（no-trigger 分支）+ ui.notify 轻提示
 * - skipped（截断/读盘失败）→ 无条件 pushWarning 点名（不管注入是否成功）
 */
function performContextRestore(
	pi: ExtensionAPI,
	reason: string,
	config: ContextRestoreConfig | undefined,
	notify: ((msg: string, type?: "info" | "warning") => void) | undefined,
): number {
	if (!config?.enabled || isSubagent()) {
		return 0;
	}

	const active = getActiveDocs();
	if (active.length === 0) {
		return 0;
	}

	const decision = buildRestoreDecision(active, config);

	// 截断/读盘失败名单：无条件点名（提醒兜底，独立于注入成败）
	if (decision.skipped.length > 0) {
		pushWarning(
			`压缩后部分上下文文档正文未能自动恢复，需要时请重新 read：\n${decision.skipped
				.map((p) => `- ${p}`)
				.join("\n")}`,
			"context-restore-skipped",
		);
	}

	if (decision.restored.length === 0) return 0;

	try {
		pi.sendMessage(
			{
				customType: "shepherd.contextRestore",
				content: `⚠️ 以下上下文文档正文已随上下文压缩挥发，现恢复如下（无需重新 read）：\n\n${decision.body}`,
				display: false,
				details: {
					restored: decision.restored,
					skipped: decision.skipped,
					reason,
				},
			},
			// triggerTurn: false → not-streaming 时走 _appendCustomMessage
			// 持久写入 session 树；三种 reason 的 session_compact 均在
			// not-streaming 状态发出（manual 空闲时 / threshold+overflow 在
			// post-run 检查），无幽灵轮次
			{ triggerTurn: false },
		);
	} catch {
		// 注入失败 → 返回 0，提醒兜底
		return 0;
	}

	notify?.(
		`✅ shepherd: 已恢复上下文文档正文 (${decision.restored
			.map((p) => basename(dirname(p)))
			.join(", ")})`,
		"info",
	);
	return decision.restored.length;
}
