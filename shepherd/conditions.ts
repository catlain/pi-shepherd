import { hasGitUntracked, isGitDirty } from "./git";

/** 内置条件类型：不依赖正则，直接检查环境状态 */
export type ConditionBuiltin =
	| "git_dirty" // git 有已跟踪文件的未提交改动（M/A/D/R）
	| "git_untracked" // git 有未跟踪文件（??）
	| "has_edits" // 本轮调用过 edit/write
	| "not_question_ending" // AI 最后一条消息不以问句结尾（用于抑制"等待回复"场景的 agent_end 提醒）
	| "always"; // 始终匹配

/** 内置条件匹配上下文 */
export interface BuiltinContext {
	hasEdits?: boolean;
	gitDirty?: boolean;
	gitUntracked?: boolean;
	lastAssistantText?: string;
}

/**
 * 宽松检测 AI 消息是否包含问句/确认模式（等待用户回复）
 *
 * 策略：全文搜索，只要出现任何问句模式就返回 true（宁可多跳，不误打扰用户）
 * 排除代码块和引用块内的内容，避免误判技术文本中的 ? 运算符等
 */
export function isQuestionEnding(text: string): boolean {
	if (!text) return false;

	// 去除代码块（```...```），避免 ?. 可选链、?: 三元等误判
	const noCodeBlocks = text.replace(/```[\s\S]*?```/g, "");
	// 去除行内代码（`...`）
	const noInlineCode = noCodeBlocks.replace(/`[^`]+`/g, "");
	// 宽松方案：保留所有行（含引用块），不做过滤
	const prose = noInlineCode;

	if (!prose.trim()) return false;

	// 1. 中英文问号出现在行末或句末（后面可能跟空格/换行/标点）
	if (/[？?][\s]*(?:[\n]|$|[。.!,，、；;:：)）\]])/m.test(prose)) return true;
	// 独立问号结尾
	if (/[？?]\s*$/m.test(prose)) return true;

	// 2. 中文疑问语气词结尾（非代码上下文）
	// "呢/吗/吧/嘛/么/啦/呗" 出现在句末
	if (/(?:呢|吗|吧|嘛|么|啦|呗)\s*[？?。.!！,，、；;:\s]*$/m.test(prose)) return true;

	// 3. 选择/确认类句式（全文搜索）
	const confirmPatterns = [
		/要不要/,
		/你觉得/,
		/你想/,
		/确认(?:一下)?/,
		/可以吗/,
		/行不行/,
		/好不好/,
		/是不是/,
		/还是说/,
		/还是先/,
		/先(?:讨论|确认|看看)/,
		/等(?:你|你(?:的)?回复)/,
		/你(?:还)?(?:有|有没有)/,
		/(?:你|您)(?:觉得|想|希望|倾向|偏好)/,
		/请(?:确认|回复|告诉)/,
		/你来(?:决定|选|定)/,
		/直接改还是/,
	];
	for (const p of confirmPatterns) {
		if (p.test(prose)) return true;
	}

	return false;
}

/** 判断单个内置条件是否满足 */
export function matchBuiltinCondition(
	builtin: ConditionBuiltin,
	ctx: BuiltinContext,
): boolean {
	switch (builtin) {
		case "always":
			return true;
		case "has_edits":
			return !!ctx.hasEdits;
		case "git_dirty":
			return (ctx.gitDirty ?? isGitDirty()) === true;
		case "git_untracked":
			return (ctx.gitUntracked ?? hasGitUntracked()) === true;
		case "git_uncommitted": {
			// 旧 check 字段迁移兼容：git_uncommitted = dirty || untracked
			const dirty = ctx.gitDirty !== undefined ? ctx.gitDirty : isGitDirty();
			const untracked =
				ctx.gitUntracked !== undefined ? ctx.gitUntracked : hasGitUntracked();
			return dirty || untracked;
		}
		case "not_question_ending":
			return !isQuestionEnding(ctx.lastAssistantText ?? "");
	}
}
