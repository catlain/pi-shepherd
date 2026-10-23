/**
 * /compact-config — 压缩配置命令（两段式子命令，对照 pi-context-manager
 * /aging-config 生态模式：无参查看含用法 / 子命令解析 / notify 反馈）。
 *
 * 用法：
 *   /compact-config                 查看两块配置与用法
 *   /compact-config tokens <N>      设恢复注入预算 maxTokens
 *   /compact-config tokens on|off   开关恢复注入
 *   /compact-config trigger <N>     设当前模型压缩触发点（内部换算 reserveTokens）
 *   /compact-config trigger         删当前模型 override，回默认
 *
 * tokens 写 shepherd.contextRestore（自家 section）；trigger 写 pi 内置
 * compaction.modelOverrides（宿主 section，change compact-config-unified D5
 * 代理写判例）。均为浅合并语义——嵌套对象读当前完整配置→合并→整体写回。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getEffectiveConfig,
	patchSettingsSection,
} from "@pi-atelier/shared-utils";
import {
	applyTriggerSet,
	describeTrigger,
	PI_DEFAULT_RESERVE_TOKENS,
	readCompactionSection,
	removeTriggerOverride,
	type TriggerModelShape,
} from "./compact-trigger";
import {
	type ContextRestoreConfig,
	DEFAULT_CONTEXT_RESTORE,
} from "./context-restore";

/** 写入全局 settings.json 的 shepherd.contextRestore（浅合并语义：整体对象写回） */
export function setContextRestoreConfig(
	patch: Partial<ContextRestoreConfig>,
): ContextRestoreConfig {
	const current = readCurrentConfig();
	const merged = { ...DEFAULT_CONTEXT_RESTORE, ...current, ...patch };
	patchSettingsSection(
		"shepherd",
		{ contextRestore: merged },
		{ contextRestore: DEFAULT_CONTEXT_RESTORE },
	);
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

const USAGE = `用法：/compact-config [tokens <N|on|off> | trigger <N>]
  tokens N          设恢复注入预算 maxTokens（1000~400000，默认 ${DEFAULT_CONTEXT_RESTORE.maxTokens}）
  tokens on / off   开关压缩后恢复注入
  trigger N         设当前模型自动压缩触发点（tokens，达到即压缩）
  trigger           删当前模型触发点，回默认（接近满窗口触发）`;

type Notify = (msg: string, level: "info" | "warning") => void;

/** 从命令 ctx 提取 trigger 所需的模型形状（无模型返回 undefined） */
function modelFromCtx(ctx: unknown): TriggerModelShape | undefined {
	const m = (
		ctx as {
			model?: { provider?: string; id?: string; contextWindow?: number };
		}
	)?.model;
	if (!m?.provider || !m?.id || typeof m.contextWindow !== "number")
		return undefined;
	return { provider: m.provider, id: m.id, contextWindow: m.contextWindow };
}

/** 无参查看：contextRestore 块 + 触发点块 + 用法 */
function showView(ctx: unknown, notify: Notify): void {
	const c = readCurrentConfig();
	let triggerBlock = "  （无当前模型，触发点不可用）";
	const model = modelFromCtx(ctx);
	if (model) triggerBlock = describeTrigger(model, readCompactionSection());
	notify(
		`contextRestore 配置：enabled=${c.enabled} maxTokens=${c.maxTokens}\n自动压缩触发点（compaction，按模型）：\n${triggerBlock}\n\n${USAGE}`,
		"info",
	);
}

/** tokens 子命令：恢复注入（contextRestore） */
function handleTokens(args: string[], notify: Notify): void {
	const val = args[1];
	if (!val) {
		notify(
			`tokens 需要参数：/compact-config tokens <N|on|off>\n${USAGE}`,
			"warning",
		);
		return;
	}
	let patch: Partial<ContextRestoreConfig> | undefined;
	if (val === "on") patch = { enabled: true };
	else if (val === "off") patch = { enabled: false };
	else if (/^\d+$/.test(val)) {
		const v = Number(val);
		if (!Number.isInteger(v) || v < 1000 || v > 400000) {
			notify(
				`无效 token 预算 "${val}"（需 1000~400000 整数）\n${USAGE}`,
				"warning",
			);
			return;
		}
		patch = { maxTokens: v };
	} else {
		notify(`无效参数 "${val}"（需正整数或 on/off）\n${USAGE}`, "warning");
		return;
	}
	const merged = setContextRestoreConfig(patch);
	notify(
		`✅ shepherd.contextRestore 已更新：enabled=${merged.enabled} maxTokens=${merged.maxTokens}（新会话生效）`,
		"info",
	);
}

/** trigger 子命令：压缩触发点（compaction.modelOverrides，无值 = 删 override 回默认） */
function handleTrigger(args: string[], ctx: unknown, notify: Notify): void {
	const model = modelFromCtx(ctx);
	if (!model) {
		notify("无当前模型，无法定位 override（尝试新会话后重试）", "warning");
		return;
	}
	const raw = args[1];
	if (raw === undefined) {
		// 无值 = 删 override 回默认（design D4 有意例外）
		const r = removeTriggerOverride(model);
		notify(
			r.changed
				? `✅ 已删除 ${r.modelKey} 触发点 override，回默认（reserveTokens=${PI_DEFAULT_RESERVE_TOKENS}，接近满窗口触发；新会话生效）`
				: `${r.modelKey} 无 override，已是默认行为`,
			"info",
		);
		return;
	}
	if (!/^\d+$/.test(raw)) {
		notify(`无效触发点 "${raw}"（需正整数或不带值）\n${USAGE}`, "warning");
		return;
	}
	const conv = applyTriggerSet(model, Number(raw));
	if (conv.ok) {
		notify(
			`✅ ${conv.modelKey} 触发点 = ${conv.triggerTokens} tokens（reserveTokens=${conv.reserveTokens}，窗口 ${model.contextWindow}；新会话生效）`,
			"info",
		);
	} else {
		notify(`${conv.error}\n${USAGE}`, "warning");
	}
}

export function registerCompactConfigCommand(pi: ExtensionAPI): void {
	pi.registerCommand("compact-config", {
		handler: async (rawArgs: string, ctx) => {
			const args = rawArgs.trim().split(/\s+/).filter(Boolean);
			const notify = ctx?.ui?.notify;
			if (!notify) return;
			if (args.length === 0) {
				showView(ctx, notify);
				return;
			}
			const sub = args[0];
			if (sub === "tokens") handleTokens(args, notify);
			else if (sub === "trigger") handleTrigger(args, ctx, notify);
			else if (/^\d+$/.test(sub) || sub === "on" || sub === "off") {
				// 旧裸语法 → 迁移提示
				notify(
					`参数格式已升级为两段式：/compact-config tokens ${sub}\n${USAGE}`,
					"warning",
				);
			} else {
				notify(`未知参数 "${sub}"\n${USAGE}`, "warning");
			}
		},
		description:
			"View/set compact config. Usage: /compact-config | /compact-config tokens <N|on|off> | /compact-config trigger <N>",
	});
}
