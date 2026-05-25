/**
 * tool_call 和 tool_result hook 处理逻辑
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	loadRules,
	ruleMatches,
	getMatchTargets,
	isRtkAvailable,
	isSubagent,
	type Rule,
} from "./rules.js";
import { type ResettableRule, type StateTracker } from "./state-tracker.js";
import { checkLineCount } from "./line-count.js";
import { pushWarning } from "./ephemeral.js";

/** 工具 hook 共享的可变状态 */
export interface ToolState {
	hasEdits: boolean;
	tracker: StateTracker;
	cachedTools: Set<string> | null;

}

export function getAvailableTools(pi: ExtensionAPI, state: ToolState): Set<string> {
	if (!state.cachedTools) {
		state.cachedTools = new Set(pi.getActiveTools());
	}
	return state.cachedTools;
}

export function toolsAvailable(rule: Rule, pi: ExtensionAPI, state: ToolState): boolean {
	if (!rule.requiresTools || rule.requiresTools.length === 0) return true;
	const tools = getAvailableTools(pi, state);
	return rule.requiresTools.every(t => tools.has(t));
}

/** 注册 tool_call hook */
export function registerToolCall(pi: ExtensionAPI, state: ToolState, rulesDir?: string): void {
	pi.on("tool_call", async (event) => {
		if (event.toolName === "edit" || event.toolName === "write") {
			state.hasEdits = true;
		}

		const rules = loadRules(rulesDir).filter(r => r.hook === "tool_call" && r.tool === event.toolName);
		if (rules.length === 0) return;

		const targets = getMatchTargets(event.toolName!, event, "tool_call");
		if (!targets || Object.keys(targets).length === 0) return;

		for (const rule of rules) {
			if (isSubagent() && rule.subagent === false) continue;
			if (!toolsAvailable(rule, pi, state)) continue;
			if (!ruleMatches(rule, event.toolName!, targets)) continue;

			if (rule.action === "block") {
				return { block: true, reason: `⛔ shepherd: ${rule.reason}` };
			}

			if (rule.action === "rewrite" && event.toolName === "bash") {
				if (!isRtkAvailable) continue;
				const cmd = targets.command;
				if (cmd && !cmd.startsWith("rtk ")) {
					(event.input as any).command = `rtk ${cmd}`;
				}
			}

			if (rule.action === "notify") {
				pushWarning(rule.reason, rule.comment);
			}
		}
	});
}

/** 注册 tool_result hook */
export function registerToolResult(pi: ExtensionAPI, state: ToolState, rulesDir?: string): void {
	pi.on("tool_result", async (event, ctx) => {
		// 行数检查（edit/write/memory_update 后）
		if (event.toolName === "edit" || event.toolName === "write") {
			const filePath = (event.input as any)?.path as string;
			if (filePath) {
				checkLineCount(filePath);
			}
		} else if (event.toolName === "memory_update") {
			// memory_update 工具内部写文件，从 tool_result 文本中提取路径
			const resultText = event.content
				?.filter((c: any) => c.type === "text")
				?.map((c: any) => c.text).join("") ?? "";
			const pathMatch = resultText.match(/(?:写入|更新|创建).*?`([^`]+\.md)`/);
			if (pathMatch?.[1]) checkLineCount(pathMatch[1]);
		}

		// 状态更新
		const resultText = event.content
			?.filter((c: any) => c.type === "text")
			?.map((c: any) => c.text).join("") ?? "";
		state.tracker.update(event.toolName, resultText.length, !!event.isError);

		const allRules = loadRules(rulesDir);
		const rules = allRules.filter(r => r.hook === "tool_result");

		// resetOn 检查
		state.tracker.resetIf(event.toolName, rules as ResettableRule[]);

		// 规则匹配
		for (const rule of rules) {
			if ((rule as any).enabled === false) continue;
			if (isSubagent() && rule.subagent === false) continue;
			if (!toolsAvailable(rule, pi, state)) continue;
			if (rule.requireSuccess && event.isError) continue;
			if (rule.tool && rule.tool !== event.toolName) continue;

			// 正则条件匹配
			if (rule.conditions || rule.pattern) {
				const targets = getMatchTargets(event.toolName!, event, "tool_result");
				if (!targets || Object.keys(targets).length === 0) continue;
				if (!ruleMatches(rule, event.toolName!, targets)) continue;
			}

			// 状态条件匹配
			if (rule.state) {
				const ruleKey = rule.comment;
				if (state.tracker.isTriggered(ruleKey)) {
					const baseGte = rule.state.gte ?? 1;
					const nextThresh = state.tracker.nextThreshold(baseGte, ruleKey);
					const stats = state.tracker.getStats(rule.state.tools ?? []);
					if (stats.count < nextThresh) continue;
				}
				if (!state.tracker.matches(rule.state)) continue;
			}

			// 执行 action：注入到临时缓冲区，由 before_provider_request 消费
			if (rule.action === "steer") {
				if (rule.state) state.tracker.markTriggered(rule.comment);
				const stats = state.tracker.getStats(rule.state?.tools ?? []);
				let reason = rule.reason
					.replace("{count}", String(stats.count))
					.replace("{chars}", String(Math.round(stats.chars / 1000)));
				pushWarning(reason, rule.comment);
			} else if (rule.action === "notify") {
				pushWarning(rule.reason, rule.comment);
			}
		}
	});
}
