/**
 * roadmap block 规则测试的共享辅助函数和规则定义
 */

import type { Rule } from "../../shepherd/rules";
import { getMatchTargets, ruleMatches, compileRules } from "../../shepherd/rules";
import type { ToolEvent } from "../../shepherd/event-types";

// ====== 规则定义（与 rules.json 中 #27-#29 一致） ======

export const roadmapBlockRules: Rule[] = [
	{
		hook: "tool_call",
		tool: "edit",
		action: "block",
		comment: "[roadmap] 禁止直接编辑 roadmap JSON — 必须用 roadmap 工具",
		conditions: [{ field: "path", pattern: "\\.roadmap\\.json$|\\broadmap/roadmap\\.json$" }],
	} as Rule,
	{
		hook: "tool_call",
		tool: "write",
		action: "block",
		comment: "[roadmap] 禁止直接写入 roadmap JSON — 必须用 roadmap 工具",
		conditions: [{ field: "path", pattern: "\\.roadmap\\.json$|\\broadmap/roadmap\\.json$" }],
	} as Rule,
	{
		hook: "tool_call",
		tool: "bash",
		action: "block",
		comment: "[roadmap] 禁止通过 bash/python 脚本直接读写 roadmap JSON — 必须用 roadmap 工具",
		conditions: [
			{
				field: "command",
				pattern:
					"((roadmap\\.json|\\.roadmap\\.json)[\\s\\S]*(open\\(|json\\.load|json\\.dump|write|sed|awk|jq|cat))|((open\\(|json\\.load|json\\.dump|write|sed|awk|jq|cat)[\\s\\S]*(roadmap\\.json|\\.roadmap\\.json))",
			},
		],
	} as Rule,
];

compileRules(roadmapBlockRules);

// ====== 辅助函数 ======

export function makeEvent(toolName: string, input: Record<string, unknown>): ToolEvent {
	return { toolName, input } as ToolEvent;
}

export function isBlocked(toolName: string, input: Record<string, unknown>): boolean {
	const event = makeEvent(toolName, input);
	const targets = getMatchTargets(toolName, event, "tool_call");
	if (Object.keys(targets).length === 0) return false;
	return roadmapBlockRules.some((rule) => {
		if (rule.tool !== toolName) return false;
		return ruleMatches(rule, targets, undefined, toolName);
	});
}
