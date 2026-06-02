import { isGitDirty, hasGitUntracked } from "./git";

/** 内置条件类型：不依赖正则，直接检查环境状态 */
export type ConditionBuiltin =
	| "git_dirty" // git 有已跟踪文件的未提交改动（M/A/D/R）
	| "git_untracked" // git 有未跟踪文件（??）
	| "git_dirty_or_untracked" // 两者任一
	| "has_edits" // 本轮调用过 edit/write
	| "always"; // 始终匹配

/** 内置条件匹配上下文 */
export interface BuiltinContext {
	hasEdits?: boolean;
	gitDirty?: boolean;
	gitUntracked?: boolean;
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
		case "git_dirty_or_untracked":
		case "git_uncommitted": {
			const dirty = ctx.gitDirty !== undefined ? ctx.gitDirty : isGitDirty();
			const untracked = ctx.gitUntracked !== undefined ? ctx.gitUntracked : hasGitUntracked();
			return dirty || untracked;
		}
	}
}
