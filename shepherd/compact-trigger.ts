/**
 * 自动压缩触发点（trigger）配置 —— /compact-config trigger 子命令内核
 *
 * pi 内置自动压缩触发公式：contextTokens > contextWindow - reserveTokens，
 * reserveTokens 可经 compaction.modelOverrides["{provider}/{id}"] 按模型覆盖，
 * 但无命令入口。本模块以「触发点」语义封装：用户说 200k 就是 200k 触发，
 * 内部换算 reserveTokens = contextWindow - trigger 后写入 modelOverrides。
 *
 * 设计（change compact-config-unified）：
 *   - D2 trigger 语义封装：校验区间 [30000, contextWindow-16384]，天然规避
 *     恒触发配置（原生 reserve 语义在小窗口模型上 reserve≥contextWindow 即恒触发）
 *   - D3 当前模型作用域：key 由 model.provider/model.id 自动构造，用户无感
 *   - D5 扩展代理写宿主 section：写入走 patchSettingsSectionWithBackup
 *     （文件锁+备份），只写 modelOverrides 单字段，保留 compaction 其他字段
 *   - D6 浅合并语义下嵌套 key 的增删均为「读-改-整体写回」modelOverrides 字段
 *   - 纯函数（换算/合并/删除/描述）与 IO（读盘/写盘）分离，便于单测
 */

import {
	getSettingsValue,
	patchSettingsSectionWithBackup,
	SETTINGS_PATH,
} from "@pi-atelier/shared-utils";

/** 模型形状（从 ctx.model 消费的字段子集，便于测试注入） */
export type TriggerModelShape = {
	provider: string;
	id: string;
	contextWindow: number;
};

/** settings.json compaction section 中本模块关心的形状（不与 pi 完整结构耦合） */
export type CompactionSection = {
	enabled?: boolean;
	reserveTokens?: number;
	keepRecentTokens?: number;
	modelOverrides?: Record<
		string,
		{ reserveTokens?: number; keepRecentTokens?: number }
	>;
};

/** pi 内核默认 reserveTokens（未配 override 时接近满窗口触发） */
export const PI_DEFAULT_RESERVE_TOKENS = 16384;

/** 触发点下限：压缩后剩余 ≈ summary + keepRecentTokens(默认 20k)，过近会压缩循环 */
export const TRIGGER_MIN_TOKENS = 30000;

/** 构造 modelOverrides 的 key（与 pi SettingsManager.getCompactionTokenSetting 同构） */
export function modelKeyOf(model: TriggerModelShape): string {
	return `${model.provider}/${model.id}`;
}

/** 触发点 N 的有效区间（整数） */
export function triggerRange(contextWindow: number): {
	min: number;
	max: number;
} {
	return {
		min: TRIGGER_MIN_TOKENS,
		max: contextWindow - PI_DEFAULT_RESERVE_TOKENS,
	};
}

export type TriggerConversion =
	| { ok: true; modelKey: string; triggerTokens: number; reserveTokens: number }
	| { ok: false; error: string };

/** 纯函数：校验触发点并换算 reserveTokens */
export function buildTriggerConversion(
	model: TriggerModelShape,
	triggerTokens: number,
): TriggerConversion {
	const { min, max } = triggerRange(model.contextWindow);
	if (!Number.isFinite(model.contextWindow)) {
		return {
			ok: false,
			error: `当前模型 contextWindow 非法（${model.contextWindow}）`,
		};
	}
	if (max < min) {
		return {
			ok: false,
			error: `当前窗口过小（${model.contextWindow}），不支持自定义触发点`,
		};
	}
	if (
		!Number.isInteger(triggerTokens) ||
		triggerTokens < min ||
		triggerTokens > max
	) {
		return {
			ok: false,
			error: `无效触发点 ${triggerTokens}（需 ${min}~${max} 整数，当前窗口 ${model.contextWindow}）`,
		};
	}
	return {
		ok: true,
		modelKey: modelKeyOf(model),
		triggerTokens,
		reserveTokens: model.contextWindow - triggerTokens,
	};
}

/** 纯函数：合并 override 进 section（新对象；保留其他模型与该模型既有 keepRecentTokens） */
export function mergeOverrideIntoSection(
	section: CompactionSection,
	modelKey: string,
	reserveTokens: number,
): CompactionSection {
	const overrides = section.modelOverrides ?? {};
	return {
		...section,
		modelOverrides: {
			...overrides,
			[modelKey]: { ...overrides[modelKey], reserveTokens },
		},
	};
}

/** 纯函数：删除 override（新对象；无该 key 时 changed=false 原样返回） */
export function removeOverrideFromSection(
	section: CompactionSection,
	modelKey: string,
): { next: CompactionSection; changed: boolean } {
	if (!section.modelOverrides || !(modelKey in section.modelOverrides)) {
		return { next: section, changed: false };
	}
	const rest = { ...section.modelOverrides };
	delete rest[modelKey];
	// 删空后留 modelOverrides: {} 无害（内核逐 key 读取，空对象 = 全默认）
	return { next: { ...section, modelOverrides: rest }, changed: true };
}

/**
 * IO：读全局 compaction section 原始 JSON。
 * 不走 getEffectiveConfig——其按 defaults 白名单过滤字段，compaction 是宿主
 * section 字段集合不固定（enabled/reserveTokens/keepRecentTokens/modelOverrides…），
 * 传 {} 会被过滤成空对象（冒烟实测）。读-改-写回语义只需原始透传。
 */
export function readCompactionSection(): CompactionSection {
	return getSettingsValue("compaction", {} as CompactionSection);
}

function writeModelOverrides(next: CompactionSection): void {
	// 只替换 modelOverrides 单字段（patch 浅合并语义下其余 compaction 字段原样保留）；
	// WithBackup 版的 settingsPath 无默认值（会写空路径），必须显式传入
	patchSettingsSectionWithBackup(
		"compaction",
		{
			modelOverrides: next.modelOverrides ?? {},
		} as Partial<CompactionSection>,
		{} as CompactionSection,
		{ settingsPath: SETTINGS_PATH },
	);
}

/** IO：设置触发点（读-改-整体写回 modelOverrides） */
export function applyTriggerSet(
	model: TriggerModelShape,
	triggerTokens: number,
): TriggerConversion {
	const conv = buildTriggerConversion(model, triggerTokens);
	if (!conv.ok) return conv;
	const section = readCompactionSection();
	const next = mergeOverrideIntoSection(
		section,
		conv.modelKey,
		conv.reserveTokens,
	);
	writeModelOverrides(next);
	return conv;
}

/** IO：删除当前模型 override（无条目时不写盘） */
export function removeTriggerOverride(model: TriggerModelShape): {
	changed: boolean;
	modelKey: string;
} {
	const modelKey = modelKeyOf(model);
	const section = readCompactionSection();
	const { next, changed } = removeOverrideFromSection(section, modelKey);
	if (changed) writeModelOverrides(next);
	return { changed, modelKey };
}

/** 生成无参查看的触发点描述行（换算语义值 + reserveTokens 存储值 + 窗口） */
export function describeTrigger(
	model: TriggerModelShape,
	section: CompactionSection,
): string {
	const key = modelKeyOf(model);
	const reserve = section.modelOverrides?.[key]?.reserveTokens;
	if (reserve === undefined) {
		return `  ${key} = 默认（接近满窗口触发，reserveTokens=${PI_DEFAULT_RESERVE_TOKENS}）`;
	}
	const trigger = model.contextWindow - reserve;
	return `  ${key} = ${trigger} tokens（reserveTokens=${reserve}，窗口 ${model.contextWindow}）`;
}
