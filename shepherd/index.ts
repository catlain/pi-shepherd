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
	CODE_EXT_RE,
	type Condition,
	compileRules,
	getMatchTargets,
	hasGitUncommittedChanges,
	isInWorktree,
	isSubagent,
	loadRules,
	loadRulesFromFile,
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
