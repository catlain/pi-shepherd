/**
 * 规则类型定义 + 支持矩阵常量（无 IO、无匹配逻辑）
 */

import type { ConditionBuiltin } from "./conditions";
import { logDiagnostic } from "./restore-log";
import type { StateCondition } from "./state-tracker";

/** 当前是否在子代理环境中 */
export const isSubagent = () =>
	!!(process.env.PI_SUBAGENT_AGENT || process.env.PI_SUBAGENT_SESSION);

/** 代码文件扩展名正则（glob 或文件名末尾） */
export const CODE_EXT_RE = /\.(py|rs|ts|js|toml|json)(\*|"|')?$/;

// ── 类型定义 ──────────────────────────────────────────────────

/**
 * conditions[].field 合法值单一来源。
 * 类型（Condition.field）、运行时校验（rules-validate.ts）、工具描述文案均从此常量派生，
 * 禁止在任何地方手写第二份清单——command/session_end 两次分叉与 reason 手动双改的共同根因治理。
 */
export const VALID_CONDITION_FIELDS = [
	"path",
	"text",
	"glob",
	"result",
	"command",
	"reason",
] as const;
export type ConditionField = (typeof VALID_CONDITION_FIELDS)[number];

export interface Condition {
	field?: ConditionField;
	pattern?: string;
	flags?: string;
	/** true 时取反：正则不匹配才算通过 */
	negate?: boolean;
	/** 内置条件：不依赖正则，直接检查环境状态（field/pattern 为占位） */
	builtin?: ConditionBuiltin;
	_compiled?: RegExp;
}

/** LLM 二级判定配置：正则初筛通过后，调 LLM 对判定文本做语义精判（是/否） */
export interface LLMJudgeConfig {
	/** 判断提示词：描述“什么样算命中”（如“判断文本中的‘可能’是否属于无根据的猜测推理”） */
	prompt: string;
	/** 规则级判断模型（provider/id），缺省回退 settings shepherd.judgeModel → ctx.model */
	model?: string;
	/** true 时答“否”才触发（默认 false：答“是”触发） */
	invert?: boolean;
}

export interface Rule {
	comment: string;
	hook?:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "session_shutdown"		| "message_end"
		| "before_provider_request"
		| "session_compact"; // 默认 "tool_call"
	tool?: string; // 默认 "bash"，支持 "|" 分隔多值匹配（如 "edit|write"）
	// 单条件模式（向后兼容）：pattern 匹配 command（bash）或 path（edit/write）
	pattern?: string;
	flags?: string;
	// 多条件 AND 模式：设置了 conditions 时忽略 pattern
	conditions?: Condition[];
	action?: "block" | "notify" | "rewrite" | "steer"; // 默认 "block"
	reason: string;
	enabled?: boolean;
	// session_shutdown / agent_end 专用：内置检查类型（旧字段，自动迁移到 conditions）
	check?: "git_uncommitted" | "has_edits" | "always";
	// agent_end 专用：只在指定 stopReason 时触发（默认 ["stop"]）
	stopReason?: ("stop" | "length" | "toolUse" | "error" | "aborted")[];
	// 有状态规则：状态条件（与 conditions 正则是 AND 关系）
	state?: StateCondition;
	// 有状态规则：当这些工具执行后重置此规则的计数
	resetOn?: string[];
	// 子代理控制：false 表示在子代理环境中跳过此规则（默认 true）
	subagent?: boolean;
	// 工具依赖：全部可用才触发（AND 语义），不设或空数组 = 不限制
	requiresTools?: string[];
	// 仅成功时触发：true 时跳过 isError 的 tool_result（默认 false）
	requireSuccess?: boolean;
	// 条件组合逻辑："and"（默认）= 所有条件都满足，"or" = 任一满足
	conditionLogic?: "and" | "or";
	// LLM 二级判定：正则/状态条件全过后追加语义精判（AND 语义，判断“否”则不触发）
	llmJudge?: LLMJudgeConfig;
	// llmJudge 判定输入源（仅 before_provider_request 生效，缺省 lastUser）：
	// lastUser = 尾部往前最近一条 user 消息的 text blocks（用户消息判定）；
	// lastAssistant = 尾部往前最近 assistant 消息的 text blocks（AI 叙述判定）。
	// message_end 下无意义（判定输入固定为整回合 assistant 文本），配了会 warn 并忽略。
	judgeSource?: "lastUser" | "lastAssistant";
	// 运行时：已触发标记（防重复）
	_triggered?: boolean;
	// 编译后的正则（运行时填充，单条件模式）
	_compiled?: RegExp;
}

/** hook × action 支持矩阵 —— 单一来源。
 * 校验器（rules-validate.ts 组合校验）与运行时警告均从此常量取支持集；
 * 运行时消费分支增删时 MUST 同步更新本矩阵（各键注释标明消费分支源码位置）。
 * 实证背景：tool_call+steer 在添加校验通过后静默失效（2026-11 规则 39 事故 + 存量 30/34 两条）。
 */
export const HOOK_ACTION_SUPPORT: Readonly<Record<string, readonly string[]>> = {
	// tool-hooks.ts handleToolCall：block / rewrite / notify（steer 无消费分支）
	tool_call: ["block", "rewrite", "notify"],
	// tool-hooks.ts handleToolResult：steer / notify
	tool_result: ["steer", "notify"],
	// message-end.ts：steer / notify（steer 经 llmJudge 精判链路）
	message_end: ["steer", "notify"],
	// agent-hooks.ts agent_end：仅 notify（pushWarning + sendMessage 队列，无 steer 分支）
	agent_end: ["notify"],
	// agent-hooks.ts session_shutdown：仅 notify（ctx.ui.notify）
	session_shutdown: ["notify"],
	// before-request.ts：steer（pushWarning + sendMessage 入历史）/ notify（仅 pushWarning）
	before_provider_request: ["steer", "notify"],
	// compaction.ts：仅 steer
	session_compact: ["steer"],
};

/** 归一化 hook：缺省 = tool_call（与 compileRules 运行时行为同源）。校验器 MUST 用归一化后的 hook 做组合校验，
 * 否则 {action:"steer"} 无 hook 的新规则会绕过组合校验后静默失效（与运行时归一化行为不一致）。 */
export function normalizeHook(rule: { hook?: string }): string {
	return rule.hook || "tool_call";
}

/** 运行时兜底警告：由 compileRules 在规则加载出口单点调用（覆盖全部 hook），
 * 兼防外部手改 rules.json 绕过校验器的路径（警告进 stderr/restore-log，不阻塞加载）。
 * Set 去重：loadRules 每次 hook 事件都会重入，同一规则只警告一次防刷屏。 */
const _warnedCombos = new Set<string>();
export function warnUnsupportedAction(hook: string, rule: Rule): void {
	const supported = HOOK_ACTION_SUPPORT[hook];
	const action = rule.action ?? "block";
	if (supported && supported.includes(action)) return;
	const key = `${hook}|${action}|${rule.comment}`;
	if (_warnedCombos.has(key)) return;
	_warnedCombos.add(key);
	logDiagnostic(
		`[shepherd] 规则 "${rule.comment ?? rule.pattern ?? "(未命名)"}" 组合无效: hook=${hook} 不消费 action=${action}，规则静默失效——请用 shepherd_rules 工具修复`,
	);
}
