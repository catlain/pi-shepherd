/**
 * Shepherd 规则工具辅助函数
 *
 * scope 路径推导、合并列表、跨 scope 去重检测。
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { listRules } from "./rules-editor";
import { findDuplicateBySignature } from "./rules-editor";

/** 项目级规则文件名 */
const PROJECT_RULES_FILE = "shepherd-rules.json";

export type Scope = "global" | "project";

/** 根据 scope 推导规则文件路径 */
export function getRulesFilePath(
	scope: Scope | undefined,
	globalDir: string,
	cwd: string,
): string {
	if (scope === "project") {
		return path.join(cwd, ".pi", "extensions", PROJECT_RULES_FILE);
	}
	// 默认 global
	return path.join(globalDir, "rules.json");
}

export interface ListRuleItem {
	index: number;
	comment: string;
	scope: Scope;
	enabled?: boolean;
	action?: string;
	tool?: string;
	hook?: string;
	[key: string]: unknown;
}

/**
 * 按_scope 列出规则。scope 不传时返回全局+项目合并列表。
 */
export function listRulesByScope(
	globalDir: string,
	cwd: string,
	scope?: Scope,
): ListRuleItem[] {
	const results: ListRuleItem[] = [];

	if (!scope || scope === "global") {
		const globalPath = path.join(globalDir, "rules.json");
		if (fs.existsSync(globalPath)) {
			const r = listRules(globalPath);
			if (!r.error && r.rules) {
				for (const rule of r.rules) {
					results.push({ ...rule, scope: "global" });
				}
			}
		}
	}

	if (!scope || scope === "project") {
		const projectPath = path.join(cwd, ".pi", "extensions", PROJECT_RULES_FILE);
		if (fs.existsSync(projectPath)) {
			const r = listRules(projectPath);
			if (!r.error && r.rules) {
				for (const rule of r.rules) {
					results.push({ ...rule, scope: "project" });
				}
			}
		}
	}

	return results;
}

/**
 * 跨 scope 去重检测：写入 A scope 时检查 B scope 是否有签名相同的规则。
 * 返回 warning 字符串或 null。
 */
export function checkCrossScopeDuplicate(
	targetScope: Scope,
	globalDir: string,
	cwd: string,
	newRule: Record<string, unknown>,
): string | null {
	const otherScope: Scope = targetScope === "global" ? "project" : "global";
	const otherPath = getRulesFilePath(otherScope, globalDir, cwd);

	if (!fs.existsSync(otherPath)) return null;

	const content = fs.readFileSync(otherPath, "utf-8");
	let rules: Record<string, unknown>[];
	try {
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed)) return null;
		rules = parsed;
	} catch {
		return null;
	}

	const dupIdx = findDuplicateBySignature(rules, newRule);
	if (dupIdx !== null) {
		const scopeLabel = otherScope === "global" ? "全局" : "项目级";
		return `⚠ ${scopeLabel}已有相似规则 [${otherScope}:${dupIdx}]`;
	}

	return null;
}

/**
 * 确保项目级规则文件的目录存在
 */
export function ensureProjectDir(cwd: string): void {
	const dir = path.join(cwd, ".pi", "extensions");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}
