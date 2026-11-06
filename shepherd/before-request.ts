/**
 * before_provider_request hook 处理逻辑
 *
 * 在每次 provider request 发出前，按规则判定 payload 尾部消息：
 * - judgeSource=lastUser：判尾部最近一条含 text 的 user 消息（用户消息判定——
 *   AI 首见请求时提醒已入历史）
 * - judgeSource=lastAssistant：判尾部最近一条 assistant 叙述（tool 前拦截——
 *   连续操作序列第 2 步起）
 *
 * 命中动作：
 * - steer = pushWarning（本轮 drainHints 单次注入，快速通道）
 *         + sendMessage({triggerTurn:false, content:提醒文本})（入会话历史持续可见，
 *           语义对齐 ADR-025 组合拳：入 _pendingCustomMessages → agent_before_settle
 *           continue → pi 官方续跑消费）
 * - notify = 仅 pushWarning（即焚）
 * 多条规则同轮命中时 reason 合并为一条 sendMessage（防续跑 turn 撕裂）。
 *
 * 判定缓存：sha1(judgeText + rule.comment) 会话级 Map，session_start 清空，
 * 上限 200 超限整体清空（防内存增长；防重试/续跑重复判定与重复注入）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
	extractLastAssistantText,
	extractLastUserText,
	type PayloadMessage,
	SHEPHERD_PREFIX,
} from "./before-request-extract";
import { pushWarning } from "./ephemeral";
import { buildBuiltinContext } from "./conditions";
import { judgePasses, setJudgeContext } from "./llm-judge";
import {
	isSubagent,
	type LoadRulesOptions,
	loadRules,
	ruleMatches,
} from "./rules";
import type { ToolState } from "./tool-hooks";
import { toolsAvailable } from "./tool-hooks";

/** 同步判定超时（比 message_end 的 15s 收紧：本场景延迟直接加在 provider request 上） */
const JUDGE_TIMEOUT_MS = 5000;
/** 判定缓存上限 */
const CACHE_LIMIT = 200;

// ── 判定缓存（会话级）──────────────────────────────────────────

const _judgeCache = new Map<string, boolean>();
/** 已注入 key（同 judgeText+comment 本会话只注入/触发一次——防续跑循环重复注入） */
const _firedKeys = new Set<string>();

/** 清空判定缓存（session_start 时由 index.ts 调用） */
export function clearJudgeCache(): void {
	_judgeCache.clear();
	_firedKeys.clear();
}

// ── hook 注册 ─────────────────────────────────────────────────

/** 注册 before_provider_request 规则处理 */
export function registerBeforeRequestRules(
	pi: ExtensionAPI,
	state: ToolState,
	rulesDir?: string,
	rulesOptions?: LoadRulesOptions,
): void {
	pi.on("before_provider_request", async (event: unknown, ctx: unknown) => {
		// 刷新 llmJudge 宿主上下文（事件回调是 ctx 权威来源，0.4.2 起的模式）
		if (ctx) setJudgeContext(ctx as any);

		const messages = (event as any)?.payload?.messages as
			| PayloadMessage[]
			| undefined;
		const rules = loadRules(rulesDir, rulesOptions).filter(
			(r) => r.hook === "before_provider_request",
		);
		if (rules.length === 0 || !messages || messages.length === 0) return;

		// 本轮提取缓存：两种源各提取一次，规则按 judgeSource 取用
		let cachedLastUser: string | null | undefined;
		let cachedLastAssistant: string | null | undefined;

		const steerReasons: string[] = [];

		for (const rule of rules) {
			if (rule.enabled === false) continue;
			if (isSubagent() && rule.subagent === false) continue;
			if (!toolsAvailable(rule, pi, state)) continue;

			const source = rule.judgeSource ?? "lastUser";
			let judgeText: string | null;
			if (source === "lastUser") {
				if (cachedLastUser === undefined)
					cachedLastUser = extractLastUserText(messages);
				judgeText = cachedLastUser;
			} else {
				if (cachedLastAssistant === undefined)
					cachedLastAssistant = extractLastAssistantText(messages);
				judgeText = cachedLastAssistant;
			}
			if (!judgeText) continue; // 无判定输入（如 toolResult-only 续请求的 lastUser）

			// 正则预筛（不命中零成本）
			if (rule.conditions && rule.conditions.length > 0) {
				const ok = ruleMatches(
					rule,
					{ text: judgeText },
					buildBuiltinContext(state),
					"",
				);
				if (!ok) continue;
			} else if (rule.pattern) {
				const re = rule._compiled ?? new RegExp(rule.pattern, rule.flags || "");
				if (!re.test(judgeText)) continue;
			} else {
				// 无条件：总是通过（慎用——每次 provider request 都会触发）
			}

			// llmJudge 判定（缓存命中跳过 LLM 调用；fail-closed 在 judgePasses 内部）
			if (rule.llmJudge) {
				const key = createHash("sha1")
					.update(judgeText + "\x00" + rule.comment)
					.digest("hex");
				let pass = _judgeCache.get(key);
				if (pass === undefined) {
					pass = await judgePasses(rule, judgeText, JUDGE_TIMEOUT_MS);
					if (_judgeCache.size >= CACHE_LIMIT) _judgeCache.clear();
					_judgeCache.set(key, pass);
				}
				if (!pass) continue;
			if (_firedKeys.has(key)) continue; // 已注入过：跳过（防续跑循环重复注入）
			_firedKeys.add(key);
			}
			// 无 llmJudge 的纯正则规则也需防重（同文本重复触发）
			else {
				const plainKey = createHash("sha1")
				.update(judgeText + "\x00" + rule.comment)
				.digest("hex");
				if (_firedKeys.has(plainKey)) continue;
				_firedKeys.add(plainKey);
			}

			// 命中 → 执行 action
			if (rule.action === "steer") {
				pushWarning(rule.reason, rule.comment);
				steerReasons.push(rule.reason);
			} else {
				// notify（校验器保证此 hook 下 action ∈ {steer, notify}）
				pushWarning(rule.reason, rule.comment);
			}
		}

		// steer：合并为一条 sendMessage 入历史（ADR-025 组合拳消费；
		// content 带提醒文本——入历史的是 content，display:false 保持 TUI 安静）
		if (steerReasons.length > 0) {
			try {
				await Promise.resolve(
					pi.sendMessage(
						{
							customType: "shepherd-before-request",
							display: false,
							content: SHEPHERD_PREFIX + "\n" + steerReasons.join("\n\n"),
						},
						{ triggerTurn: false },
					),
				);
			} catch {
				// 会话已替换等场景：静默降级为已完成的 pushWarning 单次注入
			}
		}
	});
}
