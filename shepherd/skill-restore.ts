/**
 * 技能正文恢复注入（skill-restore）
 *
 * 压缩把消息历史摘要化后，read 过的 SKILL.md 正文随之挥发。
 * 本模块承担记录与决策两职：
 *   1. 记录器：监听 tool_result，read SKILL.md 路径记入会话内存态激活集
 *   2. 注入决策：读激活集 → 磁盘读正文 → maxSkills/maxTokens 双上限截断
 *      （最近激活优先）→ 产出注入正文与未恢复名单
 *
 * 注入调用（sendMessage）与提醒联动在 compaction.ts 的 session_compact
 * 回调里完成（设计 D4 职责分离：记录器只写态，注入决策读态）。
 *
 * 生命周期=会话进程：激活集不持久化，重启丢记录（已知限制，由
 * compact-skill-reminder 规则提醒兜底）。
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** skillRestore 配置（settings.json shepherd.skillRestore 子键） */
export interface SkillRestoreConfig {
	enabled: boolean;
	maxSkills: number;
	maxTokens: number;
}

export const DEFAULT_SKILL_RESTORE: SkillRestoreConfig = {
	enabled: true,
	maxSkills: 4,
	maxTokens: 20000,
};

/**
 * 纯函数谓词：read 工具且路径以 SKILL.md 结尾（大小写不敏感）。
 * 不做磁盘访问，O(1) 判断。
 */
export function isSkillRead(
	toolName: string,
	input: Record<string, unknown> | undefined,
): boolean {
	if (toolName !== "read") return false;
	const p = input?.path;
	return typeof p === "string" && p.toLowerCase().endsWith("skill.md");
}

/** 会话内存态激活技能集（Set 插入序，尾部 = 最近激活） */
const _activeSkills = new Set<string>();

/** 记录一次技能读取（重读时移到尾部，维持"最近激活优先"序）
 * existsSync 预检：失败调用（如 ENOENT）不进激活集——正文从未进入
 * 上下文，恢复无意义；同时避免 skipped 名单误点名 */
export function recordSkillRead(
	toolName: string,
	input: Record<string, unknown> | undefined,
): void {
	if (!isSkillRead(toolName, input)) return;
	const p = input?.path;
	if (typeof p !== "string" || !existsSync(p)) return;
	_activeSkills.delete(p);
	_activeSkills.add(p);
}

/** 激活集快照（数组序 = 激活时序，尾部最近） */
export function getActiveSkills(): string[] {
	return [..._activeSkills];
}

/** 重置激活集（测试用） */
export function resetSkillTracker(): void {
	_activeSkills.clear();
}

/** 注册技能读取追踪（独立监听旁挂，不进规则引擎——设计 D3）
 *
 * 挂 tool_execution_start：宿主主调用路径的 tool_call 事件实测未派发到
 * 扩展层（真机验证：enabled 的 tool_call 规则从未触发），而
 * tool_execution_start 是 UI 执行动画的数据源，每次工具执行必发，且携带
 * {toolName, args}。代价：失败调用（如 ENOENT）也计入激活集，恢复时
 * 读盘失败会进 skipped 名单点名——宁可多注不可漏注（宁多勿缺）。
 * 另注：本模块状态为模块级 Set，import 说明符必须统一（"./skill-restore"）
 * —— jiti 对 ".js"/无扩展名两种写法产生双 cache key = 双实例，状态分裂。 */
export function registerSkillTracker(pi: ExtensionAPI): void {
	pi.on("tool_execution_start", async (event) => {
		const ev = event as { toolName?: string; args?: Record<string, unknown> };
		recordSkillRead(
			ev.toolName ?? "",
			ev.args,
		);
	});
}

/** 注入决策产物 */
export interface RestoreDecision {
	/** 恢复注入正文（空串 = 无可注入内容） */
	body: string;
	/** 成功注入的技能路径 */
	restored: string[];
	/** 未恢复路径（读盘失败或超上限截断） */
	skipped: string[];
}

/** 轻量 token 估算（字符数/4，与宿主 estimateTokens 同量级的近似） */
export function estimateSkillTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * 注入决策：按最近激活优先读盘取正文，受 maxSkills 与 maxTokens 双上限
 * 约束；被截断/读盘失败的路径进 skipped 名单（调用方负责提醒点名）。
 * 超限时继续尝试更早激活的技能（限额内最大化恢复数量）。
 */
export function buildRestoreDecision(
	skillPaths: string[],
	config: SkillRestoreConfig,
): RestoreDecision {
	const restored: string[] = [];
	const skipped: string[] = [];
	const parts: string[] = [];
	let tokensUsed = 0;

	// 最近激活优先：倒序遍历
	for (const path of [...skillPaths].reverse()) {
		if (restored.length >= config.maxSkills) {
			skipped.push(path);
			continue;
		}
		let content: string;
		try {
			content = readFileSync(path, "utf-8");
		} catch {
			skipped.push(path);
			continue;
		}
		const block = `===== 技能恢复: ${basename(dirname(path))} (${path}) =====\n${content}`;
		const blockTokens = estimateSkillTokens(block);
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
