/**
 * Shepherd 规则文件安全编辑器
 *
 * 提供 rules.json 的安全增删改查：
 * - 写入前校验（必填字段、正则合法性、枚举值）
 * - 自动备份（.bak）
 * - 写入后回读验证
 * - 失败自动回滚
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateRule } from "./rules-validate";

export type { ValidationResult } from "./rules-validate";
export { validateRule } from "./rules-validate";

// ── 类型 ──────────────────────────────────────────────────

export interface RuleSummary {
	index: number;
	comment: string;
	action?: string;
	tool?: string;
	hook?: string;
	enabled?: boolean;
	pattern?: string;
}

export interface ListResult {
	rules: RuleSummary[];
	count: number;
	error?: string;
}

export interface RuleDetail {
	index: number;
	[key: string]: unknown;
}

export interface ListDetailResult {
	rules: RuleDetail[];
	count: number;
	error?: string;
}

export interface WriteResult {
	success: boolean;
	error?: string;
	index?: number;
	deleted?: { comment: string; [key: string]: unknown };
	overwritten?: boolean;
	warning?: string;
}

// ── 文件操作辅助 ──────────────────────────────────────────

interface FileData {
	rules: Record<string, unknown>[];
	error?: string;
}

function readFile(filePath: string): FileData {
	if (!fs.existsSync(filePath)) return { rules: [] };
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return {
				rules: [],
				error: `顶层必须是 JSON 数组，当前是 ${typeof parsed}`,
			};
		}
		return { rules: parsed };
	} catch (e: unknown) {
		return { rules: [], error: `JSON 解析失败: ${e.message}` };
	}
}

function safeWrite(
	filePath: string,
	rules: Record<string, unknown>[],
): WriteResult {
	const backupPath = `${filePath}.bak`;
	if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath);
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(rules, null, "\t"), "utf-8");
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) throw new Error("not array");
		return { success: true };
	} catch {
		if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, filePath);
		return { success: false, error: "写入后验证失败，已从备份恢复" };
	}
}

// ── 去重签名 ─────────────────────────────────────────────

/** 规范化 conditions 数组：按 field+pattern 排序，取关键属性 */
function normalizeConditions(
	conditions: Array<Record<string, unknown>>,
): string {
	const normalized = conditions
		.map((c) => ({ f: c.field || "", p: c.pattern || "" }))
		.sort((a, b) => (a.f + a.p).localeCompare(b.f + b.p));
	return JSON.stringify(normalized);
}

/** 生成规则去重签名 key */
export function dedupKey(rule: Record<string, unknown>): string {
	const tool = (rule.tool as string) || "";
	const hook = (rule.hook as string) || "";
	const action = (rule.action as string) || "";
	let trigger: string;
	if (Array.isArray(rule.conditions) && rule.conditions.length > 0) {
		trigger = normalizeConditions(
			rule.conditions as Array<Record<string, unknown>>,
		);
	} else if (rule.pattern) {
		trigger = rule.pattern as string;
	} else if (rule.check) {
		trigger = rule.check as string;
	} else {
		trigger = "";
	}
	return `${tool}|${hook}|${trigger}|${action}`;
}

/** 在规则数组中查找签名相同的规则，返回 index 或 null */
export function findDuplicateBySignature(
	rules: Record<string, unknown>[],
	newRule: Record<string, unknown>,
): number | null {
	const newKey = dedupKey(newRule);
	for (let i = 0; i < rules.length; i++) {
		if (dedupKey(rules[i]) === newKey) return i;
	}
	return null;
}

// ── 公开 API ─────────────────────────────────────────────

export function listRules(filePath: string): ListResult {
	const { rules, error } = readFile(filePath);
	if (error) return { rules: [], count: 0, error };
	return {
		rules: rules.map((r, i) => ({
			index: i,
			comment: (r.comment as string) || "",
			action: r.action as string | undefined,
			tool: r.tool as string | undefined,
			hook: r.hook as string | undefined,
			enabled: r.enabled as boolean | undefined,
			pattern: r.pattern as string | undefined,
		})),
		count: rules.length,
	};
}

export function listRulesDetail(filePath: string): ListDetailResult {
	const { rules, error } = readFile(filePath);
	if (error) return { rules: [], count: 0, error };
	return {
		rules: rules.map((r, i) => ({ index: i, ...r })),
		count: rules.length,
	};
}

export function getRuleDetail(
	filePath: string,
	index: number,
): RuleDetail | { error: string } {
	const { rules, error } = readFile(filePath);
	if (error) return { error };
	if (index < 0 || index >= rules.length)
		return { error: `编号越界: ${index}（共 ${rules.length} 条）` };
	return { index, ...rules[index] };
}

export function addRule(
	filePath: string,
	rule: Record<string, unknown>,
): WriteResult {
	const { rules, error } = readFile(filePath);
	if (error) return { success: false, error };
	const validation = validateRule(rule);
	if (!validation.valid)
		return { success: false, error: validation.errors.join("; ") };
	// 去重检测：签名相同则覆盖
	const dupIdx = findDuplicateBySignature(rules, rule);
	if (dupIdx !== null) {
		rules[dupIdx] = rule;
		const writeResult = safeWrite(filePath, rules);
		return writeResult.success
			? { success: true, index: dupIdx, overwritten: true }
			: writeResult;
	}
	rules.push(rule);
	const writeResult = safeWrite(filePath, rules);
	return writeResult.success
		? { success: true, index: rules.length - 1 }
		: writeResult;
}

export function updateRule(
	filePath: string,
	index: number,
	changes: Record<string, unknown>,
): WriteResult {
	if (index < 0) return { success: false, error: `编号越界: ${index}` };
	const { rules, error } = readFile(filePath);
	if (error) return { success: false, error };
	if (index >= rules.length)
		return {
			success: false,
			error: `编号越界: ${index}（共 ${rules.length} 条）`,
		};
	const merged = { ...rules[index], ...changes };
	const validation = validateRule(merged);
	if (!validation.valid)
		return { success: false, error: validation.errors.join("; ") };
	rules[index] = merged;
	return safeWrite(filePath, rules);
}

export function deleteRule(filePath: string, index: number): WriteResult {
	if (index < 0) return { success: false, error: `编号越界: ${index}` };
	const { rules, error } = readFile(filePath);
	if (error) return { success: false, error };
	if (index >= rules.length)
		return {
			success: false,
			error: `编号越界: ${index}（共 ${rules.length} 条）`,
		};
	const deleted = rules.splice(index, 1)[0];
	const writeResult = safeWrite(filePath, rules);
	return writeResult.success
		? {
				success: true,
				deleted: { comment: (deleted.comment as string) || "", ...deleted },
			}
		: writeResult;
}
