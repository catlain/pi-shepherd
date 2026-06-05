/**
 * Shepherd — 通用 Hook 规则引擎
 *
 * 规则驱动的事件 hook，支持多种动作：
 *   - tool_call:  工具调用前（可 block 拦截 / notify 提醒 / rewrite 重写）
 *   - tool_result: 工具执行后（可 notify 提醒 / steer 向 LLM 注入 + 行数检查）
 *   - agent_end: AI 正常完成时（可 notify 提醒，支持 stopReason 过滤）
 *   - session_shutdown: 会话结束时（可 notify 提醒）
 *
 * steer/notify 提示通过 before_provider_request 临时注入到 LLM payload，
 * 不写入 session 历史，不占用后续上下文。
 *
 * 规则配置文件:
 *   全局: ~/.pi/agent/extensions/shepherd/rules.json
 *   项目级: <cwd>/.pi/extensions/shepherd-rules-*.json（自动扫描，叠加加载）
 *
 * 修改规则文件后 /reload 即可生效，无需重启 pi。
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** pi payload 消息结构的最小类型 */
interface PayloadMessage {
	role: string;
	content?: unknown;
	[key: string]: unknown;
}

/** pi provider payload 的最小类型 */
interface ProviderPayload {
	messages?: PayloadMessage[];
	[key: string]: unknown;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = __dirname;

import { getEffectiveConfig } from "@pi-atelier/shared-utils";
import {
	checkWorktrees,
	drainHints,
	hasGitUncommittedChanges,
	hasGitUntracked,
	hasWarnings,
	isSubagent,
	loadRules,
	notifySummary,
	pushWarning,
	registerMessageEnd,
	registerToolCall,
	registerToolResult,
	resetMessageEndState,
	StateTracker,
	type ToolState,
} from "./shepherd";
import { isQuestionEnding, ruleMatches } from "./shepherd/rules";
import { registerRulesEditorTool } from "./shepherd/rules-tool";

/** 本地 hints 缓冲区（收集 pi.events.emit("ephemeral:hint") 的数据） */
const _localHints: { text: string; short?: string }[] = [];

/** 可变状态：跨 hook 共享 */
let _aborted = false;
let _wasDirty = false;
const _agentEndFired = new Set<string>();
const _toolState: ToolState = {
	hasEdits: false,
	tracker: new StateTracker(),
	cachedTools: null,
};

export default function shepherdExtension(pi: ExtensionAPI) {
	// ── 读取配置（三层合并：defaults → 全局 settings → 项目 settings）──
	const shepherdConfig = getEffectiveConfig<{
		projectRulesPattern: string;
		maxWarnings: number;
	}>(
		"shepherd",
		{
			projectRulesPattern: "shepherd-rules-",
			maxWarnings: 5,
		},
		process.cwd(),
	);

	// ── 监听跨扩展 hints（通过 pi.events 绕过 jiti 多实例） ──
	pi.events.on("ephemeral:hint", (data) => {
		const { text, short } = data as { text: string; short?: string };
		_localHints.push({ text, short });
	});

	// ── before_provider_request：注入临时提示 ──────────────────
	pi.on("before_provider_request", async (event, ctx) => {
		// shepherd 规则 hints
		const shepherdText = drainHints();
		if (shepherdText) {
			_localHints.unshift({ text: shepherdText });
		}

		// 通知摘要：short 优先，fallback 到 notifySummary 截断
		const shortParts = _localHints
			.map((h) => h.short)
			.filter(Boolean) as string[];
		const longParts = _localHints
			.map((h) => (h.short ? null : h.text))
			.filter(Boolean) as string[];
		const notifyText = [...shortParts, ...longParts].join("\n\n");

		const allHints = _localHints
			.splice(0)
			.map((h) => h.text)
			.join("\n\n");
		let payload = event.payload as ProviderPayload;

		if (allHints) {
			const text = allHints;
			payload = { ...payload };
			payload.messages = [...(payload.messages ?? [])];
			payload.messages.push({
				role: "user",
				content: [{ type: "text", text }],
			});
			ctx.ui.notify?.(notifySummary(notifyText), "warning");
		}

		return payload;
	});

	// ── session_start ──────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		checkWorktrees(ctx.ui);
	});

	// ── agent_start ────────────────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		_aborted = ctx.signal?.aborted ?? false;
		_toolState.hasEdits = false;
		_toolState.cachedTools = null;
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
		const rules = loadRules(RULES_DIR, {
			projectRulesPattern: shepherdConfig.projectRulesPattern,
		}).filter((r) => r.hook === "agent_end");
		if (rules.length === 0) return;

		const lastAssistant = [...event.messages]
			.reverse()
			.find((m: PayloadMessage) => m.role === "assistant");
		const stopReason: string | undefined = (
			lastAssistant as PayloadMessage | undefined
		)?.stopReason as string | undefined;

		// 提取最后一条 assistant 消息的文本内容（用于 not_question_ending 条件）
		let lastAssistantText = "";
		if (lastAssistant) {
			const parts = (lastAssistant as PayloadMessage).content;
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
			if (!allowedReasons.includes(stopReason ?? "")) continue;
			if (_agentEndFired.has(rule.comment)) continue;
			if (isQuestion) continue; // AI 在问问题，跳过收尾提醒

			// 统一条件匹配：通过 ruleMatches 检查 conditions（含 builtin）
			const ctx: BuiltinContext = {
				hasEdits: _toolState.hasEdits,
				gitDirty: hasGitUncommittedChanges(),
				gitUntracked: hasGitUntracked(),
				lastAssistantText,
			};
			const shouldNotify = ruleMatches(rule, {}, ctx);
			if (ctx.gitDirty) _wasDirty = true;

			if (shouldNotify && rule.action === "notify") {
				_agentEndFired.add(rule.comment);
				pushWarning(rule.reason, rule.comment);
				pushed = true;
			}
		}

		// 统一发送唯一的 sendMessage(triggerTurn)：
		// - pushed：agent_end 自己推入了 warning
		// - hasWarnings()：message_end 或 tool_result 推入了 warning（它们不再自己发 sendMessage）
		// 只发一次，避免多个 hook 各发一次导致第二个 drainHints 拿空 → 空回复
		if (pushed || hasWarnings()) {
			setTimeout(() => {
				try {
					pi.sendMessage(
						{ customType: "shepherd-agent-end", display: false, content: "" },
						{ triggerTurn: true },
					);
				} catch {
					/* session 已替换 */
				}
			}, 0);
		}
	});

	// ── session_shutdown ───────────────────────────────────────
	pi.on("session_shutdown", async (_event, ctx) => {
		const rules = loadRules(RULES_DIR, {
			projectRulesPattern: shepherdConfig.projectRulesPattern,
		}).filter((r) => r.hook === "session_shutdown");
		if (rules.length === 0) return;
		for (const rule of rules) {
			// 统一条件匹配
			const builtinCtx: BuiltinContext = {
				hasEdits: false,
				gitDirty: hasGitUncommittedChanges(),
				gitUntracked: hasGitUntracked(),
			};
			const shouldNotify = ruleMatches(rule, {}, builtinCtx);
			if (shouldNotify && rule.action === "notify") {
				ctx.ui?.notify?.(`⚠️ shepherd: ${rule.reason}`, "warning");
			}
		}
	});

	// ── tool_call + tool_result（提取到 tool-hooks.ts）────────
	const _rulesOpts = {
		projectRulesPattern: shepherdConfig.projectRulesPattern,
	};
	registerToolCall(pi, _toolState, RULES_DIR, _rulesOpts);
	registerToolResult(pi, _toolState, RULES_DIR, _rulesOpts);
	registerMessageEnd(pi, _toolState, RULES_DIR, _rulesOpts);

	// ── shepherd_rules 工具：规则文件安全编辑 ───────────────────
	registerRulesEditorTool(pi, RULES_DIR, process.cwd());
}
