/**
 * Shepherd 规则工具 — list 输出格式化
 *
 * 处理 list 的两种输出模式：摘要模式和 verbose（完整 JSON）模式。
 */

import {
	getRuleDetail,
	listRules,
	listRulesDetail,
} from "./rules-editor";
import {
	type Scope,
	getRulesFilePath,
	listRulesByScope,
} from "./rules-tool-helpers";

/** 构造 pi 工具 execute 的标准返回格式 */
export function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

export const scopeLabel = (s: Scope) => (s === "global" ? "全局" : "项目级");

/** 按编号查看单条规则的完整 JSON */
export function handleListByIndex(
	scope: Scope | undefined,
	index: number,
	rulesDir: string,
	effectiveCwd: string,
) {
	const effectiveScope = scope || "global";
	const filePath = getRulesFilePath(effectiveScope, rulesDir, effectiveCwd);
	const detail = getRuleDetail(filePath, index);
	if ("error" in detail) return textResult(`❌ ${detail.error}`);
	const { index: _, ...ruleData } = detail;
	return textResult(
		`📋 规则 [${effectiveScope}:${index}] 完整内容:\n${JSON.stringify(ruleData, null, "\t")}`,
	);
}

/** verbose 模式：显示每条规则的完整 JSON */
export function handleListVerbose(
	scope: Scope | undefined,
	rulesDir: string,
	effectiveCwd: string,
) {
	if (!scope) {
		// 全部 scope
		const parts: string[] = [];
		const globalPath = getRulesFilePath("global", rulesDir, effectiveCwd);
		const projectPath = getRulesFilePath("project", rulesDir, effectiveCwd);

		const gResult = listRulesDetail(globalPath);
		if (gResult.rules.length > 0) {
			parts.push("── 全局规则 ──");
			for (const r of gResult.rules) {
				const { index: _, ...data } = r;
				parts.push(`[global:${r.index}] ${JSON.stringify(data, null, "\t")}`);
			}
		}
		const pResult = listRulesDetail(projectPath);
		if (pResult.rules.length > 0) {
			parts.push("── 项目级规则 ──");
			for (const r of pResult.rules) {
				const { index: _, ...data } = r;
				parts.push(`[project:${r.index}] ${JSON.stringify(data, null, "\t")}`);
			}
		}
		if (parts.length === 0) return textResult("暂无规则（全局和项目级均为空）。");
		return textResult(parts.join("\n\n"));
	}
	// 指定 scope
	const filePath = getRulesFilePath(scope, rulesDir, effectiveCwd);
	const result = listRulesDetail(filePath);
	if (result.error) return textResult(`❌ ${result.error}`);
	if (result.count === 0) return textResult(`暂无${scopeLabel(scope)}规则。`);
	return textResult(
		result.rules
			.map((r) => {
				const { index: _, ...data } = r;
				return `[${scope}:${r.index}] ${JSON.stringify(data, null, "\t")}`;
			})
			.join("\n\n"),
	);
}

/** 摘要模式：一行一条，只显示 comment + action + tool + hook */
export function handleListSummary(
	scope: Scope | undefined,
	rulesDir: string,
	effectiveCwd: string,
) {
	if (!scope) {
		const items = listRulesByScope(rulesDir, effectiveCwd);
		if (items.length === 0) return textResult("暂无规则（全局和项目级均为空）。");
		return textResult(
			items
				.map(
					(r) =>
						`[${r.scope}:${r.index}] ${r.comment}` +
						(r.enabled === false ? " (disabled)" : "") +
						(r.action ? ` — ${r.action}` : "") +
						(r.tool ? ` on ${r.tool}` : "") +
						(r.hook ? ` @ ${r.hook}` : ""),
				)
				.join("\n"),
		);
	}
	const filePath = getRulesFilePath(scope, rulesDir, effectiveCwd);
	const result = listRules(filePath);
	if (result.error) return textResult(`❌ ${result.error}`);
	if (result.count === 0) return textResult(`暂无${scopeLabel(scope)}规则。`);
	return textResult(
		result.rules
			.map(
				(r) =>
					`[${scope}:${r.index}] ${r.comment}` +
					(r.enabled === false ? " (disabled)" : "") +
					(r.action ? ` — ${r.action}` : "") +
					(r.tool ? ` on ${r.tool}` : "") +
					(r.hook ? ` @ ${r.hook}` : ""),
			)
			.join("\n"),
	);
}
