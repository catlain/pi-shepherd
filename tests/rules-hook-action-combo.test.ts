/**
 * hook × action 组合校验 — validateHookActionCombo / validateRule / updateRule 分层 / compileRules 运行时警告
 * 事故背景：tool_call+steer 组合无消费分支，添加校验通过、运行时静默失效（2026-11 实证）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addRule, updateRule, validateRule } from "../shepherd/rules-editor";
import {
	VALID_HOOKS,
	validateHookActionCombo,
} from "../shepherd/rules-validate";
import {
	HOOK_ACTION_SUPPORT,
	compileRules,
	type Rule,
} from "../shepherd/rules";

let tmpDir: string;
let rulesPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-combo-"));
	rulesPath = path.join(tmpDir, "rules.json");
});

afterEach(() => {
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {}
	vi.restoreAllMocks();
});

const baseRule = {
	comment: "combo test",
	reason: "test reason",
	pattern: "foo",
};

// ── 4.1 矩阵常量完整性 ──────────────────────────────────

describe("HOOK_ACTION_SUPPORT 矩阵完整性", () => {
	it("VALID_HOOKS 每个成员都被矩阵收录（未收录 = 校验器拒合法 hook）", () => {
		for (const hook of VALID_HOOKS) {
			expect(HOOK_ACTION_SUPPORT[hook], `hook=${hook}`).toBeDefined();
		}
	});
	it("矩阵每个键的 action 列表非空且值合法", () => {
		for (const [hook, actions] of Object.entries(HOOK_ACTION_SUPPORT)) {
			expect(actions.length, `hook=${hook}`).toBeGreaterThan(0);
			for (const a of actions) {
				expect(["block", "rewrite", "notify", "steer"]).toContain(a);
			}
		}
	});
});

// ── 4.2 组合校验用例（add 路径）──────────────────────────

describe("validateHookActionCombo", () => {
	it("tool_call + steer 拒绝（事故实证组合）", () => {
		const errors = validateHookActionCombo({
			...baseRule,
			hook: "tool_call",
			action: "steer",
		});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("tool_call");
		expect(errors[0]).toContain("steer");
		expect(errors[0]).toContain("block / rewrite / notify");
	});

	it("hook 缺省归一化为 tool_call：无 hook + steer 同样拒绝", () => {
		const errors = validateHookActionCombo({
			...baseRule,
			action: "steer",
		});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("tool_call");
	});

	it("action 缺省归一化为 block：tool_call 无 action 放行，message_end 无 action 拒绝", () => {
		expect(validateHookActionCombo({ ...baseRule, hook: "tool_call" })).toEqual([]);
		// 运行时默认 action=block，message_end 不消费 block → 必须拒绝，否则静默失效
		const errors = validateHookActionCombo({ ...baseRule, hook: "message_end" });
		expect(errors).toHaveLength(1);
	});

	it("合法组合放行：tool_call+notify / tool_result+steer / message_end+steer / agent_end+notify", () => {
		expect(
			validateHookActionCombo({ ...baseRule, hook: "tool_call", action: "notify" }),
		).toEqual([]);
		expect(
			validateHookActionCombo({ ...baseRule, hook: "tool_result", action: "steer" }),
		).toEqual([]);
		expect(
			validateHookActionCombo({ ...baseRule, hook: "message_end", action: "steer" }),
		).toEqual([]);
		expect(
			validateHookActionCombo({ ...baseRule, hook: "agent_end", action: "notify" }),
		).toEqual([]);
	});

	it("矩阵未收录的 hook 拒绝并提示更新矩阵", () => {
		const errors = validateHookActionCombo({
			...baseRule,
			hook: "fantasy_hook",
			action: "notify",
		});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("HOOK_ACTION_SUPPORT");
	});
});

describe("validateRule 集成（完整模式含组合校验，partial 跳过）", () => {
	it("add 路径：tool_call+steer 被 validateRule 完整模式拒绝", () => {
		const result = validateRule({
			...baseRule,
			hook: "tool_call",
			action: "steer",
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("静默失效"))).toBe(true);
	});

	it("addRule 写入路径拦截无效组合", () => {
		const r = addRule(rulesPath, {
			...baseRule,
			hook: "tool_call",
			action: "steer",
		});
		expect(r.success).toBe(false);
		expect(fs.existsSync(rulesPath)).toBe(false);
	});

	it("partial 模式跳过组合校验（由 updateRule 合并后完整校验把关）", () => {
		const result = validateRule({ action: "steer" }, { partial: true });
		// partial 只校验出现的字段；组合错误不应出现在 partial 结果中
		expect(result.errors.some((e) => e.includes("静默失效"))).toBe(false);
	});
});

// ── 4.3 updateRule 分层 ─────────────────────────────────

describe("updateRule 组合分层", () => {
	it("changes 触及 action 且产生无效组合 → 拒绝", () => {
		fs.writeFileSync(
			rulesPath,
			JSON.stringify([
				{ ...baseRule, hook: "tool_call", action: "notify", enabled: true },
			]),
			"utf-8",
		);
		const r = updateRule(rulesPath, 0, { action: "steer" });
		expect(r.success).toBe(false);
		expect(r.error).toContain("无效组合");
		// 原文件未被改写
		const persisted = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
		expect(persisted[0].action).toBe("notify");
	});

	it("changes 触及 hook 且产生无效组合 → 拒绝", () => {
		fs.writeFileSync(
			rulesPath,
			JSON.stringify([
				{ ...baseRule, hook: "message_end", action: "steer", enabled: true },
			]),
			"utf-8",
		);
		const r = updateRule(rulesPath, 0, { hook: "tool_call" });
		expect(r.success).toBe(false);
	});

	it("未触及 hook/action：存量无效组合放行 + 组合警告（不锁死，防连坐）", () => {
		fs.writeFileSync(
			rulesPath,
			JSON.stringify([
				{ ...baseRule, hook: "tool_call", action: "steer", enabled: true },
			]),
			"utf-8",
		);
		const r = updateRule(rulesPath, 0, { enabled: false });
		expect(r.success).toBe(true);
		expect(r.warning).toContain("组合无效");
		expect(r.warning).toContain("未触及不阻塞");
	});

	it("未触及组合维度且存量组合合法：无组合警告", () => {
		fs.writeFileSync(
			rulesPath,
			JSON.stringify([
				{ ...baseRule, hook: "tool_call", action: "notify", enabled: true },
			]),
			"utf-8",
		);
		const r = updateRule(rulesPath, 0, { enabled: false });
		expect(r.success).toBe(true);
		expect(r.warning).toBeUndefined();
	});

	it("changes 修复存量无效组合：正常放行且警告消失", () => {
		fs.writeFileSync(
			rulesPath,
			JSON.stringify([
				{ ...baseRule, hook: "tool_call", action: "steer", enabled: true },
			]),
			"utf-8",
		);
		const r = updateRule(rulesPath, 0, { action: "notify" });
		expect(r.success).toBe(true);
		expect(r.warning).toBeUndefined();
	});
});

// ── 4.4 运行时警告（compileRules 单点兜底）──────────────

describe("compileRules 运行时警告", () => {
	it("无效组合输出警告且不阻塞其余规则编译", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const rules: Rule[] = [
			{ ...baseRule, comment: "bad", hook: "tool_call", action: "steer", enabled: true },
			{ ...baseRule, comment: "good", hook: "tool_call", action: "notify", enabled: true },
		];
		const compiled = compileRules(rules);
		expect(compiled).toHaveLength(2);
		expect(compiled.every((r) => r._compiled instanceof RegExp)).toBe(true);
		const calls = errSpy.mock.calls.map((c) => String(c[0]));
		expect(
			calls.some((c) => c.includes('"bad"') && c.includes("组合无效")),
		).toBe(true);
		expect(calls.some((c) => c.includes('"good"'))).toBe(false);
	});

	it("hook 缺省的 steer 规则（归一化 tool_call 后）同样被警告", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		compileRules([
			{ ...baseRule, comment: "nohook", action: "steer", enabled: true },
		]);
		const calls = errSpy.mock.calls.map((c) => String(c[0]));
		expect(calls.some((c) => c.includes("hook=tool_call"))).toBe(true);
	});

	it("合法组合零警告", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		compileRules([
			{ ...baseRule, comment: "ok", hook: "message_end", action: "steer", enabled: true },
		]);
		expect(
			errSpy.mock.calls.some((c) => String(c[0]).includes("组合无效")),
		).toBe(false);
	});

	it("同一规则重复编译只警告一次（Set 去重防刷屏）", () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const rules: Rule[] = [
			{ ...baseRule, comment: "dup", hook: "tool_call", action: "steer", enabled: true },
		];
		compileRules(rules);
		compileRules(JSON.parse(JSON.stringify(rules)));
		const comboWarnings = errSpy.mock.calls
			.map((c) => String(c[0]))
			.filter((c) => c.includes("组合无效"));
		expect(comboWarnings).toHaveLength(1);
	});
});
