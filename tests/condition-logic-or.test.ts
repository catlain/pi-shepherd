/**
 * conditionLogic OR 组合 + ruleMatches 支持 builtin 条件
 *
 * 覆盖：
 * - conditionLogic 默认 "and" 行为不变
 * - conditionLogic: "or" — 任一条件满足即匹配
 * - builtin 条件作为 conditions 数组的元素
 * - builtin + 正则条件混合，AND/OR 组合
 */

import {
	type Condition,
	type ConditionBuiltin,
	compileRules,
	type Rule,
	ruleMatches,
} from "@pi-atelier/shepherd";
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock child_process
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

function mockGitStatus(lines: string[]) {
	mockExecSync.mockReturnValue(lines.join("\n"));
}

function makeBuiltinCondition(
	builtin: ConditionBuiltin,
): Condition & { builtin: ConditionBuiltin } {
	return {
		field: "path", // 占位，builtin 不需要
		pattern: "", // 占位
		builtin,
	};
}

function makeRegexCondition(
	field: "path" | "text" | "glob",
	pattern: string,
): Condition {
	return { field, pattern, flags: "" };
}

function makeRule(overrides: Partial<Rule> & { conditions?: any[] }): Rule {
	return {
		comment: "test rule",
		action: "notify",
		reason: "test",
		conditions: [],
		...overrides,
	} as Rule;
}

describe("conditionLogic: 'and'（默认）", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGitStatus([]);
	});

	it("所有条件满足 → 匹配", () => {
		const rule = makeRule({
			conditions: [
				makeRegexCondition("path", "\\.ts$"),
				makeBuiltinCondition("has_edits"),
			],
			conditionLogic: "and",
		});
		compileRules([rule]);

		const targets = { path: "foo.ts", text: "hello" };
		expect(ruleMatches(rule, targets, { hasEdits: true })).toBe(true);
	});

	it("一个不满足 → 不匹配", () => {
		const rule = makeRule({
			conditions: [
				makeRegexCondition("path", "\\.ts$"),
				makeBuiltinCondition("has_edits"),
			],
			conditionLogic: "and",
		});
		compileRules([rule]);

		const targets = { path: "foo.ts", text: "hello" };
		expect(ruleMatches(rule, targets, { hasEdits: false })).toBe(false);
	});
});

describe("conditionLogic: 'or'", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGitStatus([]);
	});

	it("任一条件满足 → 匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("git_dirty"),
				makeBuiltinCondition("git_untracked"),
			],
			conditionLogic: "or",
		});
		compileRules([rule]);

		// 只有 untracked，没有 dirty
		mockGitStatus(["?? new.ts"]);
		expect(ruleMatches(rule, {}, {})).toBe(true);
	});

	it("两个都不满足 → 不匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("git_dirty"),
				makeBuiltinCondition("git_untracked"),
			],
			conditionLogic: "or",
		});
		compileRules([rule]);

		mockGitStatus([]);
		expect(ruleMatches(rule, {}, {})).toBe(false);
	});

	it("两个都满足 → 匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("git_dirty"),
				makeBuiltinCondition("git_untracked"),
			],
			conditionLogic: "or",
		});
		compileRules([rule]);

		mockGitStatus(["M file.ts", "?? new.ts"]);
		expect(ruleMatches(rule, {}, {})).toBe(true);
	});
});

describe("builtin + 正则混合", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGitStatus([]);
	});

	it("OR: builtin 通过 + 正则不通过 → 匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("has_edits"),
				makeRegexCondition("path", "\\.rs$"),
			],
			conditionLogic: "or",
		});
		compileRules([rule]);

		// hasEdits=true 但 path 不是 .rs
		expect(ruleMatches(rule, { path: "foo.ts" }, { hasEdits: true })).toBe(
			true,
		);
	});

	it("AND: builtin 通过 + 正则不通过 → 不匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("has_edits"),
				makeRegexCondition("path", "\\.rs$"),
			],
			conditionLogic: "and",
		});
		compileRules([rule]);

		expect(ruleMatches(rule, { path: "foo.ts" }, { hasEdits: true })).toBe(
			false,
		);
	});

	it("AND: builtin 不通过 → 短路不匹配", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("git_dirty"),
				makeRegexCondition("path", "\\.ts$"),
			],
			conditionLogic: "and",
		});
		compileRules([rule]);

		mockGitStatus([]);
		expect(ruleMatches(rule, { path: "foo.ts" }, {})).toBe(false);
	});
});

describe("无 conditions 时 conditionLogic 无效", () => {
	it("无 conditions + 无 pattern → 不匹配（无匹配目标）", () => {
		const rule = makeRule({ conditionLogic: "or" });
		compileRules([rule]);
		expect(ruleMatches(rule, {}, {})).toBe(false);
	});

	it("有 pattern（单条件模式）→ 正常匹配，conditionLogic 无影响", () => {
		const rule = makeRule({
			pattern: "\\.ts$",
			conditionLogic: "or",
		});
		compileRules([rule]);
		expect(ruleMatches(rule, { path: "foo.ts" }, {})).toBe(true);
	});
});

describe("conditionLogic 默认值", () => {
	it("不设 conditionLogic → 行为等同 and", () => {
		const rule = makeRule({
			conditions: [
				makeBuiltinCondition("has_edits"),
				makeRegexCondition("path", "\\.ts$"),
			],
			// 不设 conditionLogic
		});
		compileRules([rule]);

		// 两个都满足
		expect(ruleMatches(rule, { path: "foo.ts" }, { hasEdits: true })).toBe(
			true,
		);
		// 一个不满足
		expect(ruleMatches(rule, { path: "foo.ts" }, { hasEdits: false })).toBe(
			false,
		);
	});
});
