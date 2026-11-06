/**
 * agent 生命周期 hooks — agent_start/input/agent_end/agent_before_settle/session_shutdown
 *
 * 职责：
 *   - agent_start: 初始化可变状态（abort 跟踪/编辑标记/消息末尾状态/git 脏基线）
 *   - input:       用户输入新消息时重置 agent_end 防重复标志
 *   - agent_end:   收尾规则匹配（stopReason 过滤 + 提问跳过 + builtin 条件），pushWarning
 *                  后 sendMessage(triggerTurn:false) 入队使 canContinue 成立
 *   - agent_before_settle: 官方提醒 turn 驱动（ADR-025 组合拳，见下）
 *   - session_shutdown: 会话收尾规则提醒
 *
 * 提醒 turn 官方通道（ADR-025）：pushWarning + sendMessage({triggerTurn:false})
 * → 入 _pendingCustomMessages → agent_before_settle 返回 {continue:true}
 * （pendingCustomContext 满足 canContinue）→ pi 官方续跑 provider request
 * → drainHints 注入 → AI 回应提醒。零 setTimeout、零 agent.prompt() 竞态。
 * 旧链路 sendMessage(triggerTurn)+setTimeout 与 finishRun 异步链存在竞态
 * （activeRun 未清理时 agent.prompt() throw，async rejection 被同步 try/catch
 * 漏掉 → unhandled rejection 静默失败）——禁止回退。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hasWarnings, pushWarning } from "./ephemeral";
import {
	buildBuiltinContext,
	type BuiltinContext,
	hasGitUncommittedChanges,
	hasGitUntracked,
	isSubagent,
	loadRules,
	ruleMatches,
} from "./rules";
import { isQuestionEnding } from "./rules";
import { resetMessageEndState } from "./message-end";
import type { ToolState } from "./tool-hooks";

/** 可变状态：跨 hook 共享（模块内私有） */
let _aborted = false;
let _wasDirty = false;
const _agentEndFired = new Set<string>();

/** pi payload 消息结构的最小类型（stopReason/text 提取用） */
interface PayloadMessage {
	role: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface AgentHooksDeps {
	/** 规则目录（全局 rules.json 所在） */
	rulesDir: string;
	/** 项目规则加载选项 */
	rulesOpts: { projectRulesPattern: string };
	/** 跨 hook 共享的工具状态（与 tool-hooks/message-end 同一引用） */
	toolState: ToolState;
}

export function registerAgentHooks(pi: ExtensionAPI, deps: AgentHooksDeps) {
	const { rulesDir, rulesOpts, toolState } = deps;

	// ── agent_start ────────────────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		_aborted = ctx.signal?.aborted ?? false;
		toolState.hasEdits = false;
		toolState.cachedTools = null;
		resetMessageEndState();
		if (ctx.signal && !ctx.signal.aborted) {
			ctx.signal.addEventListener("abort", () => {
				_aborted = true;
			});
		}
		_wasDirty = hasGitUncommittedChanges();
	});

	pi.on("input", async (_event) => {
		/* 用户输入新消息 — 允许 agent_end 规则再次触发 */
		_agentEndFired.clear();
	});

	// ── agent_end ──────────────────────────────────────────────
	pi.on("agent_end", async (event, _ctx) => {
		if (isSubagent() || _aborted) return;
		const rules = loadRules(rulesDir, rulesOpts).filter(
			(r) => r.hook === "agent_end",
		);
		if (rules.length === 0) return;

		const lastAssistant = [...event.messages]
			.reverse()
			.find((m) => m.role === "assistant");
		const stopReason: string | undefined = (
			lastAssistant as unknown as PayloadMessage | undefined
		)?.stopReason as string | undefined;

		// 提取最后一条 assistant 消息的文本内容（用于 not_question_ending 条件）
		let lastAssistantText = "";
		if (lastAssistant) {
			const parts = (lastAssistant as unknown as PayloadMessage).content;
			if (Array.isArray(parts)) {
				lastAssistantText = parts
					.filter((p: { type?: string }) => p.type === "text")
					.map((p: { text?: string }) => p.text ?? "")
					.join("");
			} else if (typeof parts === "string") {
				lastAssistantText = parts;
			}
		}
		let pushed = false;

		// 如果 AI 在问用户问题（等待回复），跳过所有 agent_end 提醒
		const isQuestion = isQuestionEnding(lastAssistantText);

		for (const rule of rules) {
			const allowedReasons = rule.stopReason ?? ["stop"];
			if (!allowedReasons.includes((stopReason ?? "") as never)) continue;
			if (_agentEndFired.has(rule.comment)) continue;
			if (isQuestion) continue; // AI 在问问题，跳过收尾提醒

			// 统一条件匹配：通过 ruleMatches 检查 conditions（含 builtin）
			// git_* / lastAssistantText 为场景特定字段，经工厂 extra 注入
			const ctx: BuiltinContext = buildBuiltinContext(toolState, {
				gitDirty: hasGitUncommittedChanges(),
				gitUntracked: hasGitUntracked(),
				lastAssistantText,
			});
			const shouldNotify = ruleMatches(rule, {}, ctx);
			if (ctx.gitDirty) _wasDirty = true;

			if (shouldNotify && rule.action === "notify") {
				_agentEndFired.add(rule.comment);
				pushWarning(rule.reason, rule.comment);
				pushed = true;
			}
		}

		// 收尾规则 pushWarning 后：sendMessage(triggerTurn:false) 入
		// _pendingCustomMessages 队列，使 agent_before_settle 的
		// canContinue（pendingCustomContext）为真，continue: true 合法。
		// 提醒 turn 的驱动由 agent_before_settle 统一承担（ADR-025）。
		if (pushed) {
			try {
				Promise.resolve()
					.then(() =>
						pi.sendMessage(
							{
								customType: "shepherd-agent-end",
								display: false,
								content: "",
							},
							{ triggerTurn: false },
						),
					)
					.catch(() => {
						// 会话已替换等场景：静默降级，提醒降为下轮 drainHints 注入
					});
			} catch {
				// 同步 throw 同降级
			}
		}
	});

	// ── agent_before_settle：统一驱动提醒 turn（官方零竞态通道）──────
	// 官方语义："Fired before final settlement. May append entries and ensure one next provider request."
	// 消息流：message_end（llmJudge 判定 + pushWarning）→ agent_end（收尾规则 pushWarning）
	//       → 此处 continue: true → pi 官方机制驱动下一 provider request
	//       → before_provider_request 的 drainHints 注入提醒 → AI 回应提醒。
	// 死循环防护：message_end/agent_end 的防重复标志消费后即清 → 收敛。
	pi.on("agent_before_settle", async (_event, _ctx) => {
		if (isSubagent() || _aborted) return {};
		// hasWarnings 隐含 pending custom 消息已入队（message_end/agent_end
		// 的 pushWarning 均伴随 sendMessage(triggerTurn:false)），
		// canContinue 的 pendingCustomContext 条件成立，continue 合法。
		if (hasWarnings()) {
			return { continue: true };
		}
		return {};
	});

	// ── session_shutdown ───────────────────────────────────────
	pi.on("session_shutdown", async (_event, ctx) => {
		const rules = loadRules(rulesDir, rulesOpts).filter(
			(r) => r.hook === "session_shutdown",
		);
		if (rules.length === 0) return;
		for (const rule of rules) {
			// 统一条件匹配
			const builtinCtx: BuiltinContext = buildBuiltinContext(toolState, {
				gitDirty: hasGitUncommittedChanges(),
				gitUntracked: hasGitUntracked(),
			});
			const shouldNotify = ruleMatches(rule, {}, builtinCtx);
			if (shouldNotify && rule.action === "notify") {
				ctx.ui?.notify?.(`⚠️ shepherd: ${rule.reason}`, "warning");
			}
		}
	});
}
