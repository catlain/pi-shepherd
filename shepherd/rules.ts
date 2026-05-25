/**
 * Guard 规则类型定义 + 规则加载/编译/匹配 + git 辅助函数
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { StateCondition, ResettableRule } from "./state-tracker.js";
import { pushRuleError } from "./ephemeral.js";

// ── 类型定义 ──────────────────────────────────────────────────

export interface Condition {
	field: "path" | "text" | "glob";
	pattern: string;
	flags?: string;
	_compiled?: RegExp;
}

export interface Rule {
	comment: string;
	hook?: "tool_call" | "tool_result" | "agent_end" | "session_shutdown"; // 默认 "tool_call"
	tool?: string;                       // 默认 "bash"
	// 单条件模式（向后兼容）：pattern 匹配 command（bash）或 path（edit/write）
	pattern?: string;
	flags?: string;
	// 多条件 AND 模式：设置了 conditions 时忽略 pattern
	conditions?: Condition[];
	action?: "block" | "notify" | "rewrite" | "steer"; // 默认 "block"
	reason: string;
	enabled?: boolean;
	// session_shutdown / agent_end 专用：内置检查类型
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
	// 运行时：已触发标记（防重复）
	_triggered?: boolean;
	// 编译后的正则（运行时填充，单条件模式）
	_compiled?: RegExp;
}

// ── Git 辅助函数 ──────────────────────────────────────────────

/** 检测 git 工作区是否有未提交的改动 */
export function hasGitUncommittedChanges(): boolean {
	try {
		const cwd = process.cwd();
		const status = execSync("git status --porcelain", {
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
			cwd,
		}).toString().trim();
		// 只关注已跟踪文件的变更（M/A/D/R 等），忽略 untracked（?? 前缀）
		const tracked = status.split("\n").filter(line => line && !line.startsWith("??"));
		return tracked.length > 0;
	} catch {
		return false;
	}
}

/** 当前是否在 worktree 中 */
export function isInWorktree(): boolean {
	try {
		const cwd = process.cwd();
		if (/\/\.worktrees\/[^/]+/.test(cwd)) return true;
		const gitDir = execSync("git rev-parse --git-dir", {
			timeout: 3000, stdio: ["pipe", "pipe", "pipe"], cwd,
		}).toString().trim();
		const commonDir = execSync("git rev-parse --git-common-dir", {
			timeout: 3000, stdio: ["pipe", "pipe", "pipe"], cwd,
		}).toString().trim();
		return gitDir !== commonDir && gitDir !== ".git";
	} catch {
		return false;
	}
}

/** 当前是否在子代理环境中 */
export const isSubagent = () => !!(process.env.PI_SUBAGENT_AGENT || process.env.PI_SUBAGENT_SESSION);

// ── 代码文件扩展名 ─────────────────────────────────────────

/** 代码文件扩展名正则（glob 或文件名末尾） */
export const CODE_EXT_RE = /\.(py|rs|ts|js|toml|json)(\*|"|')?$/;

// ── 规则加载/编译/匹配 ────────────────────────────────────────

// RULES_PATH 已移除——规则路径由 loadRules(rulesDir) 参数传入

/** 从单个文件加载规则（不编译），处理文件不存在和 JSON 解析错误 */
export function loadRulesFromFile(filePath: string): { rules: Rule[]; error?: string } {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			const fileName = path.basename(filePath);
			return { rules: [], error: `${fileName}: 顶层必须是 JSON 数组，当前是 ${typeof parsed}` };
		}
		return { rules: parsed };
	} catch (e: any) {
		if (e.code === "ENOENT") return { rules: [] };
		const fileName = path.basename(filePath);
		return { rules: [], error: `${fileName}: JSON 解析失败 — ${e.message}` };
	}
}

/** 编译规则：正则编译 + 默认值填充 */
export function compileRules(rules: Rule[]): Rule[] {
	// 过滤禁用规则
	const active = rules.filter(r => r.enabled !== false);
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
		// 填充默认值
		if (!rule.hook) rule.hook = "tool_call";
		if (!rule.tool) rule.tool = "bash";
		if (!rule.action) rule.action = "block";
	}
	return active;
}

/** 加载所有规则并校验格式，返回编译后的规则列表 */
export function loadRules(rulesDir?: string): Rule[] {
	const allRules: Rule[] = [];
	const errors: string[] = [];

	// 1. 全局规则：由消费者传入规则文件所在目录
	if (rulesDir) {
		const result = loadRulesFromFile(path.join(rulesDir, "rules.json"));
		allRules.push(...result.rules);
		if (result.error) errors.push(result.error);
	}

	// 2. 项目级规则（<cwd>/.pi/extensions/shepherd-rules-*.json）
	const projectExtDir = path.join(process.cwd(), ".pi", "extensions");
	if (fs.existsSync(projectExtDir)) {
		for (const file of fs.readdirSync(projectExtDir).sort()) {
			if (file.startsWith("shepherd-rules-") && file.endsWith(".json")) {
				const result = loadRulesFromFile(path.join(projectExtDir, file));
				allRules.push(...result.rules);
				if (result.error) errors.push(result.error);
			}
		}
	}

	// 格式校验失败时推入 shepherd 提示缓冲区
	if (errors.length > 0) {
		const msg = errors.join("；");
		console.error(`[shepherd] 规则文件格式错误: ${msg}`);
		pushRuleError(msg);
	}

	return compileRules(allRules);
}

/** 从事件中提取匹配目标（多字段）
 * @param phase 调用阶段："tool_call" 时 git commit 会被短路（避免 commit message 误触发 block 规则），
 *              "tool_result" 时不短路（允许 git commit 后的 steer/notify 规则触发）
 */
export function getMatchTargets(tool: string, event: any, phase?: string): Record<string, string> {
	if (tool === "bash") {
		let command = (event.input as any)?.command || "";
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
			text = edits.flatMap((e: any) => [e.oldText || "", e.newText || ""]).join("\n");
		}
	} else if (tool === "write") {
		text = (event.input as any)?.content || "";
	}
	return { path: pathVal, text, command: "", glob: "" };
}

/** 判断规则是否匹配事件 */
export function ruleMatches(rule: Rule, tool: string, targets: Record<string, string>): boolean {
	// 多条件 AND 模式
	if (rule.conditions && rule.conditions.length > 0) {
		return rule.conditions.every(cond => {
			const target = targets[cond.field] || "";
			return cond._compiled?.test(target) ?? false;
		});
	}
	// 单条件模式（向后兼容）
	if (rule._compiled) {
		const target = targets[tool === "bash" ? "command" : "path"] || "";
		return rule._compiled.test(target);
	}
	return false;
}

/** rtk 可用性（模块加载时检测） */
export const isRtkAvailable: boolean = (() => {
	try {
		execSync("which rtk", { timeout: 2000, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
})();
