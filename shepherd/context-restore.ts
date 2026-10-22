/**
 * 上下文文档恢复注入（context-restore）
 *
 * 压缩把消息历史摘要化后，read 过的上下文文档正文随之挥发——SKILL.md
 * 还有 system prompt 索引兜底，openspec 文档（proposal/design/tasks/spec）
 * 挥发后连索引都没有。本模块承担激活源适配与决策两职：
 *   1. 激活源：session_compact 事件 payload 的
 *      compactionEntry.details.readFiles（宿主语义 = 上次压缩 readFiles
 *      继承 ∪ 本次挥发窗口内全部 read 调用）→ 谓词过滤为候选清单
 *   2. 注入决策：读盘取正文 → maxTokens 预算截断（最近激活优先）→
 *      产出注入正文与未恢复名单
 *
 * 无自有状态：不挂 tool_execution_start、不做实时记录——resume / reload
 * / fork 等进程边界天然免疫（jsonl 连续统计，宿主维护激活真源）。
 *
 * 注入调用（sendMessage）与提醒联动在 compaction.ts 的 session_compact
 * 回调里完成（职责分离：本模块纯函数，副作用集中在回调）。
 */

import { readFileSync } from "node:fs";

/** contextRestore 配置（settings.json shepherd.contextRestore 子键）
 * 仅 token 预算约束（不限文档个数——超预算按最近激活优先截断） */
export interface ContextRestoreConfig {
	enabled: boolean;
	maxTokens: number;
}

export const DEFAULT_CONTEXT_RESTORE: ContextRestoreConfig = {
	enabled: true,
	maxTokens: 40000,
};

/**
 * 纯函数谓词：路径满足其一——
 *   a) 以 SKILL.md 结尾（大小写不敏感）
 *   b) 规范化路径含 openspec/ 段且以 .md 结尾
 * 不做磁盘访问，O(1) 判断。
 */
export function isContextDocPath(path: string): boolean {
	const norm = path.replace(/\\/g, "/");
	const lower = norm.toLowerCase();
	if (lower.endsWith("skill.md")) return true;
	const inOpenspec = norm.includes("/openspec/") || norm.startsWith("openspec/");
	return inOpenspec && lower.endsWith(".md");
}

/**
 * 激活源适配：readFiles（宿主 compactionEntry.details.readFiles）→
 * 受保护文档候选清单。
 * 数组序即激活序（宿主：继承段在前、本次窗口 read 按消息序追加，尾部
 * = 最近激活）；Set 保序去重（防御继承与窗口重叠）。
 * 非数组/缺失输入 → 空清单（空集路径，调用方负责观测提示）。
 */
export function filterContextDocs(readFiles: unknown): string[] {
	if (!Array.isArray(readFiles)) return [];
	const seen = new Set<string>();
	for (const p of readFiles) {
		if (typeof p !== "string") continue;
		if (!isContextDocPath(p)) continue;
		seen.add(p);
	}
	return [...seen];
}

/** 注入决策产物 */
export interface RestoreDecision {
	/** 恢复注入正文（空串 = 无可注入内容） */
	body: string;
	/** 成功注入的文档路径 */
	restored: string[];
	/** 未恢复路径（读盘失败或超上限截断） */
	skipped: string[];
}

/** 轻量 token 估算（字符数/4，与宿主 estimateTokens 同量级的近似） */
export function estimateDocTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** 边界标记显示名：父目录/文件名 两段式（技能如 code-graph/SKILL.md，
 * 文档如 add-skill-restore-injection/design.md——两类都有区分度） */
function displayPath(path: string): string {
	const norm = path.replace(/\\/g, "/");
	const segs = norm.split("/").filter(Boolean);
	return segs.length >= 2 ? `${segs[segs.length - 2]}/${segs[segs.length - 1]}` : norm;
}

/**
 * 注入决策：按最近激活优先读盘取正文，受 maxTokens 预算约束
 * （不限文档个数）；被截断/读盘失败的路径进 skipped 名单（调用方负责
 * 提醒点名）。超限时继续尝试更早激活的文档（限额内最大化恢复数量）。
 */
export function buildRestoreDecision(
	docPaths: string[],
	config: ContextRestoreConfig,
): RestoreDecision {
	const restored: string[] = [];
	const skipped: string[] = [];
	const parts: string[] = [];
	let tokensUsed = 0;

	// 最近激活优先：倒序遍历
	for (const path of [...docPaths].reverse()) {
		let content: string;
		try {
			content = readFileSync(path, "utf-8");
		} catch {
			skipped.push(path);
			continue;
		}
		const block = `===== 上下文恢复: ${displayPath(path)} (${path}) =====\n${content}`;
		const blockTokens = estimateDocTokens(block);
		if (tokensUsed + blockTokens > config.maxTokens) {
			skipped.push(path);
			continue;
		}
		tokensUsed += blockTokens;
		restored.push(path);
		parts.push(block);
	}

	return { body: parts.join("\n\n"), restored, skipped };
}
