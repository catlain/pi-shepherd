/**
 * /compact-config — 压缩相关配置命令（contextRestore，对照 pi-context-manager
 * /aging-config 生态模式：无参查看含用法 / 带参解析 / notify 反馈）。
 *
 * 用法：
 *   /compact-config                 查看当前配置与用法
 *   /compact-config 50000           设 maxTokens（注入 token 预算，唯一数字参数）
 *   /compact-config on | off        开关恢复注入
 *
 * 写入走 patchSettingsSection（shared-utils：文件锁 + 备份）。注意它是
 * 浅合并——嵌套对象先读当前完整配置→合并 patch→整体写回。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getEffectiveConfig, patchSettingsSection } from "@pi-atelier/shared-utils";
import { DEFAULT_CONTEXT_RESTORE, type ContextRestoreConfig } from "./context-restore";

/** 写入全局 settings.json 的 shepherd.contextRestore（浅合并语义：整体对象写回） */
export function setContextRestoreConfig(
	patch: Partial<ContextRestoreConfig>,
): ContextRestoreConfig {
	const current = readCurrentConfig();
	const merged = { ...DEFAULT_CONTEXT_RESTORE, ...current, ...patch };
	patchSettingsSection("shepherd", { contextRestore: merged }, { contextRestore: DEFAULT_CONTEXT_RESTORE });
	return merged;
}

/** 读当前全局生效的 contextRestore（三层合并结果，仅展示/合并基线用） */
function readCurrentConfig(): ContextRestoreConfig {
	const { config } = getEffectiveConfig(
		"shepherd",
		{ contextRestore: DEFAULT_CONTEXT_RESTORE },
		process.cwd(),
	);
	return config.contextRestore ?? DEFAULT_CONTEXT_RESTORE;
}

const USAGE = `用法：/compact-config [N | on | off]
  N          设 maxTokens（注入 token 预算，当前默认 ${DEFAULT_CONTEXT_RESTORE.maxTokens}）
  on / off   开关压缩后恢复注入`;

export function registerCompactConfigCommand(pi: ExtensionAPI): void {
	pi.registerCommand("compact-config", {
		handler: async (rawArgs: string, ctx) => {
			const args = rawArgs.trim().split(/\s+/).filter(Boolean);
			const notify = ctx?.ui?.notify;
			if (args.length === 0) {
				const c = readCurrentConfig();
				notify?.(
					`contextRestore 配置：enabled=${c.enabled} maxTokens=${c.maxTokens}\n${USAGE}`,
					"info",
				);
				return;
			}
			const arg = args[0];
			let patch: Partial<ContextRestoreConfig> | undefined;
			if (arg === "on") patch = { enabled: true };
			else if (arg === "off") patch = { enabled: false };
			else if (/^\d+$/.test(arg)) {
				const v = Number(arg);
				if (!Number.isInteger(v) || v < 1000 || v > 400000) {
					notify?.(`无效 token 预算 "${arg}"（需 1000~400000 整数）\n${USAGE}`, "warning");
					return;
				}
				patch = { maxTokens: v };
			} else {
				notify?.(`未知参数 "${arg}"\n${USAGE}`, "warning");
				return;
			}
			const merged = setContextRestoreConfig(patch);
			notify?.(
				`✅ shepherd.contextRestore 已更新：enabled=${merged.enabled} maxTokens=${merged.maxTokens}（新会话生效）`,
				"info",
			);
		},
		description: "View or set compact-restore config. Usage: /compact-config | /compact-config 50000 | /compact-config off",
	});
}
