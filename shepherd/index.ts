/**
 * @pi-atelier/shepherd — barrel export
 */
export {
	loadRules, loadRulesFromFile, compileRules,
	getMatchTargets, ruleMatches,
	isInWorktree,
	isSubagent, hasGitUncommittedChanges,
	type Rule, type Condition,
} from "./rules";
export { StateTracker, type StateCondition, type ResettableRule } from "./state-tracker";
export { checkLineCount } from "./line-count";
export { pushWarning, notifySummary, hasWarnings } from "./ephemeral";
export { peekHints, peekLabels, pushHint, hasHints, drainHints } from "./ephemeral-shared";
export { registerToolCall, registerToolResult, type ToolState, getAvailableTools, toolsAvailable } from "./tool-hooks";
export { checkWorktrees } from "./worktree-check";
