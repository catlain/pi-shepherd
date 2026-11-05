/**
 * 规则匹配逻辑：事件 → 匹配目标提取 + 规则/条件/工具名匹配（无 IO）
 */

import { execSync } from "node:child_process";
import type { BuiltinContext } from "./conditions";
import { matchBuiltinCondition } from "./conditions";
import { CODE_EXT_RE } from "./rules-types";
import type { Rule } from "./rules-types";
import type { Condition } from "./rules-types";
import type { ToolEvent } from "./tool-event-types";
import { extractResultText } from "./tool-event-types";

/** 从事件中提取匹配目标（多字段）
 * @param phase 调用阶段："tool_call" 时 git commit 会被短路（避免 commit message 误触发 block 规则），
 *              "tool_result" 时不短路（允许 git commit 后的 steer/notify 规则触发）
 *              "tool_result" 时额外注入 result 字段（工具输出文本）
 */
export function getMatchTargets(
	tool: string,
	event: ToolEvent,
	phase?: string,
): Record<string, string> {
	// result 字段：仅 tool_result 阶段提取工具输出文本
	const result = phase === "tool_result" ? extractResultText(event) : "";

	if (tool === "bash") {
		const command = (event.input as any)?.command || "";
		// git commit 的 message 可能包含 sed -i / echo >> 等关键词，跳过匹配
		// 注意：命令可能是 "cd xxx && git commit ..." 格式
		// 但仅在 tool_call 阶段短路——tool_result 阶段需要匹配 git commit 后的 steer 规则
		if (phase === "tool_call" && /(^|&&|;)\s*git\s+commit\b/.test(command)) {
			return { result } as Record<string, string>;
		}
		return {
			command,
			path: "",
			text: "",
			glob: "",
			result,
		};
	}
	// grep 工具：提取 glob（文件过滤）、path（搜索目录）、text（搜索模式）
	if (tool === "grep") {
		const pathVal = (event.input as any)?.path || "";
		const globVal = (event.input as any)?.glob || "";
		const patternVal = (event.input as any)?.pattern || "";

		// 有 glob 时必须是代码扩展名，无 glob 时默认全搜（也触发提醒）
		if (globVal && !CODE_EXT_RE.test(globVal)) {
			return { result } as Record<string, string>;
		}
		return { path: pathVal, text: patternVal, command: "", glob: globVal, result };
	}
	// edit / write / 其他工具
	const pathVal = (event.input as any)?.path || "";
	let text = "";
	if (tool === "edit") {
		const edits = (event.input as any)?.edits;
		if (Array.isArray(edits)) {
			text = edits.map((e: { newText?: string }) => e.newText || "").join("\n");
		}
	} else if (tool === "write") {
		text = (event.input as any)?.content || "";
	} else {
		// 其他工具：把所有参数序列化为 text，供 conditions 的 text field 匹配
		const input = event.input as any;
		if (input && typeof input === "object") {
			text = JSON.stringify(input);
		}
	}
	return { path: pathVal, text, command: "", glob: "", result };
}

/** 判断规则是否匹配事件
 * @param rule 规则对象
 * @param toolOrTargets 工具名（旧签名）或匹配目标（新签名）
 * @param targetsOrCtx 匹配目标（旧签名）或 BuiltinContext（新签名）
 * @param tool 工具名（仅新签名使用）
 */
export function ruleMatches(
	rule: Rule,
	toolOrTargets: string | Record<string, string>,
	targetsOrCtx?: Record<string, string> | BuiltinContext,
	tool?: string,
): boolean {
	// 参数重载：兼容旧签名 ruleMatches(rule, tool, targets)
	let targets: Record<string, string>;
	let ctx: BuiltinContext | undefined;
	let toolName: string | undefined;
	if (typeof toolOrTargets === "string") {
		// 旧签名: ruleMatches(rule, toolName, targets)
		toolName = toolOrTargets;
		targets = (targetsOrCtx as Record<string, string>) ?? {};
		ctx = undefined;
	} else {
		// 新签名: ruleMatches(rule, targets, ctx?, tool?)
		targets = toolOrTargets;
		ctx = targetsOrCtx as BuiltinContext | undefined;
		toolName = tool;
	}
	// 多条件模式
	if (rule.conditions && rule.conditions.length > 0) {
		const logic = rule.conditionLogic ?? "and";
		if (logic === "or") {
			return rule.conditions.some((cond) => matchCondition(cond, targets, ctx));
		}
		return rule.conditions.every((cond) => matchCondition(cond, targets, ctx));
	}
	// 单条件模式（向后兼容）
	if (rule._compiled) {
		const field = toolName === "bash" ? "command" : "path";
		const target = targets[field] || "";
		return rule._compiled.test(target);
	}
	return false;
}

/** 判断单个条件是否满足（正则或 builtin） */
function matchCondition(
	cond: Condition,
	targets: Record<string, string>,
	ctx?: BuiltinContext,
): boolean {
	// builtin 条件：直接检查环境状态
	if (cond.builtin) {
		const result = matchBuiltinCondition(cond.builtin, ctx ?? {});
		return cond.negate ? !result : result;
	}
	// 正则条件
	const field = cond.field ?? "path";
	const target = targets[field] || "";
	const matched = cond._compiled?.test(target) ?? false;
	return cond.negate ? !matched : matched;
}

/** tool 字段匹配：支持 "|" 分隔的多值（如 "edit|write"）。
 * 注意：纯精确匹配（split 后 includes），无通配/后缀——MCP 工具必须写全名 mcp__server__tool。 */
export function toolMatches(
	ruleTool: string | undefined,
	eventTool: string,
): boolean {
	if (!ruleTool) return true; // 未指定 tool 时默认匹配所有（由 hook 类型决定范围）
	return ruleTool
		.split("|")
		.map((t) => t.trim())
		.includes(eventTool);
}

/** rtk 可用性（懒加载 + 缓存，避免模块加载时 2s timeout） */
let _rtkAvailable: boolean | undefined;
export function isRtkAvailable(): boolean {
	if (_rtkAvailable !== undefined) return _rtkAvailable;
	try {
		execSync("which rtk", { timeout: 2000, stdio: "pipe" });
		_rtkAvailable = true;
	} catch {
		_rtkAvailable = false;
	}
	return _rtkAvailable;
}
