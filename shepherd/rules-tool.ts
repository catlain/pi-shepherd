/**
 * Shepherd 规则编辑工具注册
 *
 * 注册 shepherd_rules 工具到 pi，提供规则文件的安全增删改查。
 * 支持 scope 参数区分全局/项目级规则。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { addRule, deleteRule, listRules, updateRule } from "./rules-editor";
import {
	type Scope,
	checkCrossScopeDuplicate,
	ensureProjectDir,
	getRulesFilePath,
	listRulesByScope,
} from "./rules-tool-helpers";

/** 构造 pi 工具 execute 的标准返回格式 */
function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

export function registerRulesEditorTool(pi: ExtensionAPI, rulesDir: string, cwd?: string) {
	const effectiveCwd = cwd || process.cwd();

	pi.registerTool({
		name: "shepherd_rules",
		label: "Shepherd Rules Editor",
		description:
			"安全编辑 shepherd 规则文件。支持 list（列出所有规则）、add（添加规则）、update（部分更新规则）、delete（删除规则）。" +
			"scope='global' 操作全局规则 (~/.pi/agent/extensions/shepherd/rules.json)；" +
			"scope='project' 操作当前项目规则 (<cwd>/.pi/extensions/shepherd-rules.json)。" +
			"写入前自动校验必填字段和正则合法性，写入后回读验证，失败自动从备份恢复。" +
			"同签名规则（tool+hook+pattern/check+action）自动覆盖而非追加。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "add", "update", "delete"],
					description: "操作类型",
				},
				scope: {
					type: "string",
					enum: ["global", "project"],
					description:
						"操作目标：global=全局规则（默认），project=当前项目规则。list 不传 scope 时返回全局+项目合并列表（标注来源），写操作默认 global。",
				},
				rule: {
					type: "object",
					description: "add 时传入的完整规则对象（必须含 comment 和 reason）",
				},
				index: {
					type: "number",
					description: "update/delete 时指定规则编号（0-based，仅在对应 scope 文件内的索引）",
				},
				changes: {
					type: "object",
					description: "update 时要修改的字段（只传需要改的）",
				},
			},
			required: ["action"],
		},
		async execute(
			_toolCallId: string,
			params: {
				action: "list" | "add" | "update" | "delete";
				scope?: Scope;
				rule?: Record<string, unknown>;
				index?: number;
				changes?: Record<string, unknown>;
			},
		) {
			const scope = params.scope;
			const scopeLabel = (s: Scope) => (s === "global" ? "全局" : "项目级");

			switch (params.action) {
				case "list": {
					if (!scope) {
						// 无 scope → 合并全局+项目，标注来源
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
					// 指定 scope → 只列对应
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
				case "add": {
					if (!params.rule) return textResult("❌ add 需要 rule 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(targetScope, rulesDir, effectiveCwd);
					// 项目级写入前确保目录存在
					if (targetScope === "project") ensureProjectDir(effectiveCwd);
					const result = addRule(filePath, params.rule);
					if (!result.success) return textResult(`❌ ${result.error}`);
					// 跨 scope warning
					const warning = checkCrossScopeDuplicate(targetScope, rulesDir, effectiveCwd, params.rule);
					const overwrittenMsg = result.overwritten ? " (覆盖已有同签名规则)" : "";
					const warningMsg = warning ? `\n${warning}` : "";
					return textResult(
						`✅ ${scopeLabel(targetScope)}规则已添加 [${targetScope}:${result.index}]${overwrittenMsg}${warningMsg}`,
					);
				}
				case "update": {
					if (params.index === undefined) return textResult("❌ update 需要 index 参数");
					if (!params.changes) return textResult("❌ update 需要 changes 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(targetScope, rulesDir, effectiveCwd);
					const result = updateRule(filePath, params.index, params.changes);
					return result.success
						? textResult(`✅ ${scopeLabel(targetScope)}规则 [${targetScope}:${params.index}] 已更新`)
						: textResult(`❌ ${result.error}`);
				}
				case "delete": {
					if (params.index === undefined) return textResult("❌ delete 需要 index 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(targetScope, rulesDir, effectiveCwd);
					const result = deleteRule(filePath, params.index);
					return result.success
						? textResult(
								`✅ ${scopeLabel(targetScope)}规则已删除: ${(result.deleted as any)?.comment || ""}`,
							)
						: textResult(`❌ ${result.error}`);
				}
				default:
					return textResult(`❌ 未知操作: ${(params as any).action}`);
			}
		},
	});
}
