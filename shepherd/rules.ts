/**
 * Guard 规则类型定义 + 规则加载/编译/匹配
 */

export type { BuiltinContext } from "./conditions";

// 条件匹配从 conditions.ts re-export
export { isQuestionEnding, matchBuiltinCondition } from "./conditions";
// git 相关函数从 git.ts re-export，保持向后兼容
export {
	hasGitUncommittedChanges,
	hasGitUntracked,
	isGitDirty,
	isGitDirtyOrUntracked,
	isInWorktree,
} from "./git";

/** 当前是否在子代理环境中 */
export const isSubagent = () =>
	!!(process.env.PI_SUBAGENT_AGENT || process.env.PI_SUBAGENT_SESSION);

/** 代码文件扩展名正则（glob 或文件名末尾） */
export const CODE_EXT_RE = /\.(py|rs|ts|js|toml|json)(\*|"|')?$/;

import * as fs from "node:fs";
import * as path from "node:path";
import { matchBuiltinCondition } from "./conditions";
import { pushRuleError } from "./ephemeral.js";
import type { StateCondition } from "./state-tracker.js";
import type { ToolEvent } from "./tool-event-types.js";

// ── 类型定义 ──────────────────────────────────────────────────

export interface Condition {
	field: "path" | "text" | "glob";
	pattern: string;
	flags?: string;
	/** true 时取反：正则不匹配才算通过 */
	negate?: boolean;
	/** 内置条件：不依赖正则，直接检查环境状态（field/pattern 为占位） */
	builtin?: ConditionBuiltin;
	_compiled?: RegExp;
}

// ConditionBuiltin 类型定义移到 conditions.ts，这里 re-export
export type { ConditionBuiltin } from "./conditions";

export interface Rule {
	comment: string;
	hook?:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "session_end"
		| "session_shutdown"
		| "message_end"; // 默认 "tool_call"
	tool?: string; // 默认 "bash"，支持 "|" 分隔多值匹配（如 "edit|write"）
	// 单条件模式（向后兼容）：pattern 匹配 command（bash）或 path（edit/write）
	pattern?: string;
	flags?: string;
	// 多条件 AND 模式：设置了 conditions 时忽略 pattern
	conditions?: Condition[];
	action?: "block" | "notify" | "rewrite" | "steer"; // 默认 "block"
	reason: string;
	enabled?: boolean;
	// session_shutdown / agent_end 专用：内置检查类型（旧字段，自动迁移到 conditions）
	check?: "git_uncommitted" | "has_edits" | "always";
	// agent_end 专用：只在指定 stopReason 时触发（默认 ["stop"]）
	stopReason?: ("stop" | "length" | "toolUse" | "error" | "aborted")[];
	// 有状态规则：状态条件（与 conditions 正则是 AND 关系）
	state?: StateCondition;
	// 有状态规则：当这些工具执行后重置此规则的计数
	resetOn?: string[];
	// 子代理控制：false 表示在子代理环境中跳过此规则（默认 true）
	subagent?: boolean;
	// 工具依赖：全部可用才触发（AND 语义），不设或空数组 = 不限制
	requiresTools?: string[];
	// 仅成功时触发：true 时跳过 isError 的 tool_result（默认 false）
	requireSuccess?: boolean;
	// 条件组合逻辑："and"（默认）= 所有条件都满足，"or" = 任一满足
	conditionLogic?: "and" | "or";
	// 运行时：已触发标记（防重复）
	_triggered?: boolean;
	// 编译后的正则（运行时填充，单条件模式）
	_compiled?: RegExp;
}

// ── 内置条件匹配 ────────────────────────────────────────────

// ── 规则加载/编译/匹配 ────────────────────────────────────────

// RULES_PATH 已移除——规则路径由 loadRules(rulesDir) 参数传入

/** 从单个文件加载规则（不编译），处理文件不存在和 JSON 解析错误 */
export function loadRulesFromFile(filePath: string): {
	rules: Rule[];
	error?: string;
} {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			const fileName = path.basename(filePath);
			return {
				rules: [],
				error: `${fileName}: 顶层必须是 JSON 数组，当前是 ${typeof parsed}`,
			};
		}
		return { rules: parsed };
	} catch (e: unknown) {
		if (e.code === "ENOENT") return { rules: [] };
		const fileName = path.basename(filePath);
		return { rules: [], error: `${fileName}: JSON 解析失败 — ${e.message}` };
	}
}

/** 编译规则：正则编译 + 默认值填充 */
export function compileRules(rules: Rule[]): Rule[] {
	// 过滤禁用规则
	const active = rules.filter((r) => r.enabled !== false);
	for (const rule of active) {
		// 多条件模式：编译每个 condition
		if (rule.conditions && rule.conditions.length > 0) {
			for (const cond of rule.conditions) {
				cond._compiled = new RegExp(cond.pattern, cond.flags || "");
			}
		} else if (rule.pattern) {
			// 单条件模式：编译 pattern（向后兼容）
			rule._compiled = new RegExp(rule.pattern, rule.flags || "");
		}
		// check 字段自动迁移为 conditions（向后兼容）
		if (rule.check && (!rule.conditions || rule.conditions.length === 0)) {
			const builtinName = rule.check === "has_edits" ? "has_edits" : rule.check;
			rule.conditions = [{ builtin: builtinName as ConditionBuiltin }];
		}
		// 填充默认值
		if (!rule.hook) rule.hook = "tool_call";
		if (!rule.tool) rule.tool = "bash";
		if (!rule.action) rule.action = "block";
	}
	return active;
}

/** 加载所有规则并校验格式，返回编译后的规则列表 */
export interface LoadRulesOptions {
	/** 已弃用，保留以兼容旧调用方 */
	projectRulesPattern?: string;
}

/** loadRules 缓存：基于文件 mtime 的自动失效 */
let _cacheKey = "";
let _cacheValue: Rule[] = [];

function buildCacheKey(rulesDir?: string): string {
	const parts: string[] = [];
	if (rulesDir) {
		const globalPath = path.join(rulesDir, "rules.json");
		try {
			parts.push(`${globalPath}:${fs.statSync(globalPath).mtimeMs}`);
		} catch {
			parts.push(`${globalPath}:none`);
		}
	}
	const projectPath = path.join(process.cwd(), ".pi", "extensions", "shepherd-rules.json");
	try {
		parts.push(`${projectPath}:${fs.statSync(projectPath).mtimeMs}`);
	} catch {
		parts.push(`${projectPath}:none`);
	}
	return parts.join("|");
}

/** 清除 loadRules 缓存（规则文件变更后调用） */
export function invalidateRulesCache(): void {
	_cacheKey = "";
	_cacheValue = [];
}

export function loadRules(
	rulesDir?: string,
	options?: LoadRulesOptions,
): Rule[] {
	const key = buildCacheKey(rulesDir);
	if (key === _cacheKey) return _cacheValue;

	const allRules: Rule[] = [];
	const errors: string[] = [];

	// 1. 全局规则：rules.json
	if (rulesDir) {
		const result = loadRulesFromFile(path.join(rulesDir, "rules.json"));
		allRules.push(...result.rules);
		if (result.error) errors.push(result.error);
	}

	// 2. 项目级规则：<cwd>/.pi/extensions/shepherd-rules.json
	const projectRulesPath = path.join(process.cwd(), ".pi", "extensions", "shepherd-rules.json");
	if (fs.existsSync(projectRulesPath)) {
		const result = loadRulesFromFile(projectRulesPath);
		allRules.push(...result.rules);
		if (result.error) errors.push(result.error);
	}

	// 格式校验失败时推入 shepherd 提示缓冲区
	if (errors.length > 0) {
		const msg = errors.join("；");
		console.error(`[shepherd] 规则文件格式错误: ${msg}`);
		pushRuleError(msg);
	}

	_cacheKey = key;
	_cacheValue = compileRules(allRules);
	return _cacheValue;
}

/** 从事件中提取匹配目标（多字段）
 * @param phase 调用阶段："tool_call" 时 git commit 会被短路（避免 commit message 误触发 block 规则），
 *              "tool_result" 时不短路（允许 git commit 后的 steer/notify 规则触发）
 */
export function getMatchTargets(
	tool: string,
	event: ToolEvent,
	phase?: string,
): Record<string, string> {
	if (tool === "bash") {
		const command = (event.input as any)?.command || "";
		// git commit 的 message 可能包含 sed -i / echo >> 等关键词，跳过匹配
		// 注意：命令可能是 "cd xxx && git commit ..." 格式
		// 但仅在 tool_call 阶段短路——tool_result 阶段需要匹配 git commit 后的 steer 规则
		if (phase === "tool_call" && /(^|&&|;)\s*git\s+commit\b/.test(command)) {
			return {} as Record<string, string>;
		}
		return {
			command,
			path: "",
			text: "",
			glob: "",
		};
	}
	// grep 工具：提取 glob（文件过滤）、path（搜索目录）、text（搜索模式）
	if (tool === "grep") {
		const pathVal = (event.input as any)?.path || "";
		const globVal = (event.input as any)?.glob || "";
		const patternVal = (event.input as any)?.pattern || "";

		// 有 glob 时必须是代码扩展名，无 glob 时默认全搜（也触发提醒）
		if (globVal && !CODE_EXT_RE.test(globVal)) {
			return {} as Record<string, string>;
		}
		return { path: pathVal, text: patternVal, command: "", glob: globVal };
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
	return { path: pathVal, text, command: "", glob: "" };
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
	const target = targets[cond.field] || "";
	const matched = cond._compiled?.test(target) ?? false;
	return cond.negate ? !matched : matched;
}

/** tool 字段匹配：支持 "|" 分隔的多值（如 "edit|write"） */
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
