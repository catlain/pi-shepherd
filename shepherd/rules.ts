/**
 * 规则加载/编译/缓存 + 对外门面 re-export（保持既有 import 路径兼容）
 *
 * 模块拆分（2026-11 hook-action-validation 收尾）：
 * - rules-types.ts  类型 + HOOK_ACTION_SUPPORT 矩阵 + normalizeHook/warnUnsupportedAction（无 IO）
 * - rules-match.ts   匹配逻辑：getMatchTargets/ruleMatches/matchCondition/toolMatches（无 IO）
 * - rules.ts（本文件）加载/编译/mtime 缓存
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ConditionBuiltin } from "./conditions";
import { pushRuleError } from "./ephemeral";
import { normalizeHook, warnUnsupportedAction } from "./rules-types";
// 门面 re-export：类型与常量（rules-types）
export {
	CODE_EXT_RE,
	HOOK_ACTION_SUPPORT,
	isSubagent,
	normalizeHook,
	VALID_CONDITION_FIELDS,
	warnUnsupportedAction,
} from "./rules-types";
export type {
	Condition,
	ConditionField,
	LLMJudgeConfig,
	Rule,
} from "./rules-types";
// 门面 re-export：匹配逻辑（rules-match）
export { getMatchTargets, isRtkAvailable, ruleMatches, toolMatches } from "./rules-match";
// 条件匹配从 conditions.ts re-export
export { buildBuiltinContext, isQuestionEnding, matchBuiltinCondition } from "./conditions";
export type { BuiltinContext, ConditionBuiltin, ToolStateLike } from "./conditions";
// git 相关函数从 git.ts re-export，保持向后兼容
export {
	hasGitUncommittedChanges,
	hasGitUntracked,
	isGitDirty,
	isGitDirtyOrUntracked,
	isInWorktree,
} from "./git";
import { logDiagnostic } from "./restore-log";

// ── 规则加载/编译/匹配 ────────────────────────────────────────

// RULES_PATH 已移除——规则路径由 loadRules(rulesDir) 参数传入

/** 从单个文件加载规则（不编译），处理文件不存在和 JSON 解析错误 */
export function loadRulesFromFile(filePath: string): {
	rules: import("./rules-types").Rule[];
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
		if (e instanceof Error && "code" in e && e.code === "ENOENT") return { rules: [] };
		const fileName = path.basename(filePath);
		const msg = e instanceof Error ? e.message : String(e);
		return { rules: [], error: `${fileName}: JSON 解析失败 — ${msg}` };
	}
}

/** 编译规则：正则编译 + 默认值填充 */
export function compileRules(rules: import("./rules-types").Rule[]): import("./rules-types").Rule[] {
	// 过滤禁用规则
	const active = rules.filter((r) => r.enabled !== false);
	for (const rule of active) {
		// 多条件模式：编译每个 condition
		if (rule.conditions && rule.conditions.length > 0) {
			for (const cond of rule.conditions) {
				// has_read 无 pattern 时跳过编译（保留 undefined）：空正则恒匹配会让
				// "无 pattern → 不通过"语义反转为"读过任意文件 → 通过"（smell 发现2）
				if (cond.builtin === "has_read" && !cond.pattern) continue;
					cond._compiled = new RegExp(cond.pattern ?? "", cond.flags || "");
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
		// 填充默认值（hook 经 normalizeHook 归一化，与校验器同源）
		rule.hook = normalizeHook(rule) as import("./rules-types").Rule["hook"];
		if (!rule.tool) rule.tool = "bash";
		if (!rule.action) rule.action = "block";
		// llmJudge 加载时校验：prompt 非空 + 仅 {message_end, before_provider_request} 支持；无效则剥离该字段（降级为纯正则行为）
		if (rule.llmJudge) {
			const problems: string[] = [];
			if (typeof rule.llmJudge.prompt !== "string" || rule.llmJudge.prompt.trim() === "") {
				problems.push("llmJudge.prompt 缺失或为空");
			}
			if (rule.hook !== "message_end" && rule.hook !== "before_provider_request") {
				problems.push(
					`llmJudge 仅支持 message_end / before_provider_request hook，当前 hook=${rule.hook}`,
				);
			}
			if (problems.length > 0) {
				logDiagnostic(`[shepherd] 规则 "${rule.comment ?? rule.pattern ?? "(未命名)"}" llmJudge 配置无效: ${problems.join("；")}，已剥离 llmJudge（降级为纯正则）`);
				delete rule.llmJudge;
			}
		}
		// judgeSource 仅 before_provider_request 有意义：其他 hook 下 warn 并忽略（防误解配置）
		if (rule.judgeSource && rule.hook !== "before_provider_request") {
			logDiagnostic(
				`[shepherd] 规则 "${rule.comment ?? "(未命名)"}" judgeSource 仅在 before_provider_request hook 下生效，当前 hook=${rule.hook}，已忽略`,
			);
			delete rule.judgeSource;
		}
		// hook×action 组合兜底警告（归一化后单点检查，覆盖全部 hook 处理器）
		warnUnsupportedAction(rule.hook!, rule);
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
let _cacheValue: import("./rules-types").Rule[] = [];

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
): import("./rules-types").Rule[] {
	const key = buildCacheKey(rulesDir);
	if (key === _cacheKey) return _cacheValue;

	const allRules: import("./rules-types").Rule[] = [];
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
		logDiagnostic(`[shepherd] 规则文件格式错误: ${msg}`);
		pushRuleError(msg);
	}

	_cacheKey = key;
	_cacheValue = compileRules(allRules);
	return _cacheValue;
}
