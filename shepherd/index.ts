/**
 * @pi-atelier/shepherd — barrel export
 */

export { hasWarnings, notifySummary, pushWarning } from "./ephemeral";
export {
	drainHints,
	hasHints,
	peekHints,
	peekLabels,
	pushHint,
} from "./ephemeral-shared";
export { checkLineCount } from "./line-count";
export {
	extractAssistantText,
	registerMessageEnd,
	resetMessageEndState,
} from "./message-end";
export {
	type BuiltinContext,
	CODE_EXT_RE,
	type Condition,
	type ConditionBuiltin,
	compileRules,
	getMatchTargets,
	hasGitUncommittedChanges,
	hasGitUntracked,
	isGitDirty,
	isGitDirtyOrUntracked,
	isInWorktree,
	isSubagent,
	loadRules,
	loadRulesFromFile,
	matchBuiltinCondition,
	type Rule,
	ruleMatches,
	toolMatches,
} from "./rules";
export {
	type ResettableRule,
	type StateCondition,
	StateTracker,
} from "./state-tracker";
export {
	getAvailableTools,
	registerToolCall,
	registerToolResult,
	type ToolState,
	toolsAvailable,
} from "./tool-hooks";
export { checkWorktrees } from "./worktree-check";
