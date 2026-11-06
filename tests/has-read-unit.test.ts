/**
 * has_read 单元测试 — conditions.ts 谓词分支 / StateTracker readPaths / rules-validate 校验
 * 纯单元（无模块 mock）
 */

import { describe, expect, it } from "vitest";
import { matchBuiltinCondition } from "../shepherd/conditions";
import { StateTracker } from "../shepherd/state-tracker";
import { validateRule } from "../shepherd/rules-validate";

describe("matchBuiltinCondition — has_read", () => {
	it("已读路径匹配 pattern → true", () => {
		expect(
			matchBuiltinCondition(
				"has_read",
				{ readPaths: ["D:/q/.pi/skills/factor-optimizer/SKILL.md"] },
				{ pattern: "factor-optimizer", _compiled: /factor-optimizer/ },
			),
		).toBe(true);
	});

	it("readPaths 空集 → false", () => {
		expect(
			matchBuiltinCondition(
				"has_read",
				{ readPaths: [] },
				{ pattern: "factor-optimizer", _compiled: /factor-optimizer/ },
			),
		).toBe(false);
	});

	it("readPaths 缺省（undefined）→ false", () => {
		expect(
			matchBuiltinCondition(
				"has_read",
				{},
				{ pattern: "factor-optimizer", _compiled: /factor-optimizer/ },
			),
		).toBe(false);
	});

	it("cond 未带 _compiled → false（不抛异常）", () => {
		expect(matchBuiltinCondition("has_read", { readPaths: ["x"] }, {})).toBe(
			false,
		);
	});

	it("严粒度 pattern 半读防护：只读 SKILL.md 不算读过 references", () => {
		const strict = {
			pattern: "references/tool-commands",
			_compiled: /references\/tool-commands/,
		};
		expect(
			matchBuiltinCondition(
				"has_read",
				{ readPaths: [".pi/skills/factor-optimizer/SKILL.md"] },
				strict,
			),
		).toBe(false);
		expect(
			matchBuiltinCondition(
				"has_read",
				{ readPaths: [".pi/skills/factor-optimizer/references/tool-commands.md"] },
				strict,
			),
		).toBe(true);
	});
});

describe("StateTracker — readPaths", () => {
	it("addReadPath + getReadPaths 往返", () => {
		const t = new StateTracker();
		t.addReadPath(".pi/skills/db-query/SKILL.md");
		expect(t.getReadPaths()).toEqual([".pi/skills/db-query/SKILL.md"]);
	});

	it("空路径防御（不记入）", () => {
		const t = new StateTracker();
		t.addReadPath("");
		expect(t.getReadPaths()).toEqual([]);
	});

	it("去重（同路径重复 read 只记一次）", () => {
		const t = new StateTracker();
		t.addReadPath("a.md");
		t.addReadPath("a.md");
		expect(t.getReadPaths()).toEqual(["a.md"]);
	});
});

describe("validateRule — has_read 校验", () => {
	it("has_read 缺 pattern → 报错", () => {
		const res = validateRule({
			comment: "t",
			reason: "r",
			hook: "tool_call",
			action: "notify",
			conditions: [{ builtin: "has_read", negate: true }],
		} as any);
		expect(res.errors.some((e: string) => e.includes("has_read"))).toBe(true);
	});

	it("非法 builtin 枚举 → 报错", () => {
		const res = validateRule({
			comment: "t",
			reason: "r",
			hook: "tool_call",
			action: "notify",
			conditions: [{ builtin: "foo_bar", pattern: "x" }],
		} as any);
		expect(res.errors.some((e: string) => e.includes("foo_bar"))).toBe(true);
	});

	it("合法 has_read（带 pattern）→ 无错", () => {
		const res = validateRule({
			comment: "t",
			reason: "r",
			hook: "tool_call",
			action: "notify",
			conditions: [
				{ builtin: "has_read", pattern: "factor-optimizer", negate: true },
			],
		} as any);
		expect(res.errors).toEqual([]);
	});
});
