/**
 * Shepherd 规则编辑工具注册
 *
 * 注册 shepherd_rules 工具到 pi，提供规则文件的安全增删改查。
 * 支持 scope 参数区分全局/项目级规则。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { addRule, deleteRule, updateRule } from "./rules-editor";
import {
	checkCrossScopeDuplicate,
	ensureProjectDir,
	getRulesFilePath,
	type Scope,
} from "./rules-tool-helpers";
import {
	handleListByIndex,
	handleListSummary,
	handleListVerbose,
	scopeLabel,
	textResult,
} from "./rules-tool-list";

export function registerRulesEditorTool(
	pi: ExtensionAPI,
	rulesDir: string,
	cwd?: string,
) {
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
		promptSnippet: "编辑 shepherd 防护规则",
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
					description:
						"规则编号（0-based，仅在对应 scope 文件内的索引）。list 时传 index 显示该条规则的完整 JSON；update/delete 时指定要操作的规则。",
				},
				verbose: {
					type: "boolean",
					description:
						"list 时传 true 显示每条规则的完整字段（含 reason、conditions、pattern 等），默认 false 只显示摘要。",
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
				verbose?: boolean;
				changes?: Record<string, unknown>;
			},
		) {
			const scope = params.scope;

			switch (params.action) {
				case "list": {
					// index 指定 → 显示单条完整 JSON
					if (params.index !== undefined) {
						return handleListByIndex(
							scope,
							params.index,
							rulesDir,
							effectiveCwd,
						);
					}
					// verbose=true → 显示所有规则的完整信息
					if (params.verbose === true) {
						return handleListVerbose(scope, rulesDir, effectiveCwd);
					}
					// 默认摘要模式
					return handleListSummary(scope, rulesDir, effectiveCwd);
				}
				case "add": {
					if (!params.rule) return textResult("❌ add 需要 rule 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(
						targetScope,
						rulesDir,
						effectiveCwd,
					);
					if (targetScope === "project") ensureProjectDir(effectiveCwd);
					const result = addRule(filePath, params.rule);
					if (!result.success) return textResult(`❌ ${result.error}`);
					const warning = checkCrossScopeDuplicate(
						targetScope,
						rulesDir,
						effectiveCwd,
						params.rule,
					);
					const overwrittenMsg = result.overwritten
						? " (覆盖已有同签名规则)"
						: "";
					const warningMsg = warning ? `\n${warning}` : "";
					return textResult(
						`✅ ${scopeLabel(targetScope)}规则已添加 [${targetScope}:${result.index}]${overwrittenMsg}${warningMsg}`,
					);
				}
				case "update": {
					if (params.index === undefined)
						return textResult("❌ update 需要 index 参数");
					if (!params.changes) return textResult("❌ update 需要 changes 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(
						targetScope,
						rulesDir,
						effectiveCwd,
					);
					const result = updateRule(filePath, params.index, params.changes);
					return result.success
						? textResult(
								`✅ ${scopeLabel(targetScope)}规则 [${targetScope}:${params.index}] 已更新`,
							)
						: textResult(`❌ ${result.error}`);
				}
				case "delete": {
					if (params.index === undefined)
						return textResult("❌ delete 需要 index 参数");
					const targetScope = scope || "global";
					const filePath = getRulesFilePath(
						targetScope,
						rulesDir,
						effectiveCwd,
					);
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
