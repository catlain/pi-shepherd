/**
 * Shepherd 规则编辑工具注册
 *
 * 注册 shepherd_rules 工具到 pi，提供规则文件的安全增删改查。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { addRule, deleteRule, listRules, updateRule } from "./rules-editor";

/** 构造 pi 工具 execute 的标准返回格式 */
function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

export function registerRulesEditorTool(pi: ExtensionAPI, rulesFilePath: string) {
	pi.registerTool({
		name: "shepherd_rules",
		label: "Shepherd Rules Editor",
		description:
			"安全编辑 shepherd 规则文件。支持 list（列出所有规则）、add（添加规则）、update（部分更新规则）、delete（删除规则）。" +
			"写入前自动校验必填字段和正则合法性，写入后回读验证，失败自动从备份恢复。",
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["list", "add", "update", "delete"],
					description: "操作类型",
				},
				rule: {
					type: "object",
					description: "add 时传入的完整规则对象（必须含 comment 和 reason）",
				},
				index: {
					type: "number",
					description: "update/delete 时指定规则编号（0-based）",
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
				rule?: Record<string, unknown>;
				index?: number;
				changes?: Record<string, unknown>;
			},
		) {
			switch (params.action) {
				case "list": {
					const result = listRules(rulesFilePath);
					if (result.error) return textResult(`❌ ${result.error}`);
					if (result.count === 0) return textResult("暂无规则。");
					return textResult(
						result.rules
							.map(
								(r) =>
									`[${r.index}] ${r.comment}` +
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
					const result = addRule(rulesFilePath, params.rule);
					return result.success
						? textResult(`✅ 规则已添加 [${result.index}]`)
						: textResult(`❌ ${result.error}`);
				}
				case "update": {
					if (params.index === undefined) return textResult("❌ update 需要 index 参数");
					if (!params.changes) return textResult("❌ update 需要 changes 参数");
					const result = updateRule(rulesFilePath, params.index, params.changes);
					return result.success
						? textResult(`✅ 规则 [${params.index}] 已更新`)
						: textResult(`❌ ${result.error}`);
				}
				case "delete": {
					if (params.index === undefined) return textResult("❌ delete 需要 index 参数");
					const result = deleteRule(rulesFilePath, params.index);
					return result.success
						? textResult(`✅ 规则已删除: ${(result.deleted as any)?.comment || ""}`)
						: textResult(`❌ ${result.error}`);
				}
				default:
					return textResult(`❌ 未知操作: ${(params as any).action}`);
			}
		},
	});
}
