/**
 * validateRule + listRules — 校验与读取测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listRules, validateRule } from "../shepherd/rules-editor";

let tmpDir: string;
let rulesPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-editor-"));
	rulesPath = path.join(tmpDir, "rules.json");
});

afterEach(() => {
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {}
});

function writeRules(rules: object[]): void {
	fs.writeFileSync(rulesPath, JSON.stringify(rules, null, "\t"), "utf-8");
}

// ── validateRule ─────────────────────────────────────────

describe("validateRule", () => {
	it("合法规则通过校验", () => {
		const result = validateRule({
			comment: "test rule",
			reason: "test reason",
			pattern: "foo\\.bar",
		});
		expect(result.valid).toBe(true);
	});

	it("缺少 comment 报错", () => {
		const result = validateRule({ reason: "test reason" });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("缺少必填字段: comment");
	});

	it("缺少 reason 报错", () => {
		const result = validateRule({ comment: "test rule" });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("缺少必填字段: reason");
	});

	it("comment + reason 都缺报两个错", () => {
		const result = validateRule({ pattern: "foo" });
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(2);
	});

	it("无效正则 pattern 报错", () => {
		const result = validateRule({
			comment: "bad regex",
			reason: "test",
			pattern: "[invalid",
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("正则");
	});

	it("无效 flags 报错", () => {
		const result = validateRule({
			comment: "bad flags",
			reason: "test",
			pattern: "foo",
			flags: "xyz",
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("flags");
	});

	it("conditions 中无效正则报错", () => {
		const result = validateRule({
			comment: "bad cond",
			reason: "test",
			conditions: [{ field: "path", pattern: "[invalid" }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("conditions[0]");
	});

	it("无 pattern 无 conditions 合法（agent_end check 类）", () => {
		const result = validateRule({
			comment: "check",
			reason: "提醒",
			hook: "agent_end",
			action: "notify", // 矩阵：agent_end 仅消费 notify；缺省归一化为 block 会被组合校验拒绝（防静默失效）
			check: "git_uncommitted",
		});
		expect(result.valid).toBe(true);
	});

	it("非法 action 值报错", () => {
		const result = validateRule({
			comment: "bad action",
			reason: "test",
			action: "explode",
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("action");
	});

	it("action 为 skip/disable/off/mute 等关闭意图时附带禁用引导", () => {
		for (const bad of ["skip", "disable", "off", "mute", "close", "stop"]) {
			const result = validateRule({
				comment: "想关闭规则",
				reason: "test",
				action: bad,
			});
			expect(result.valid).toBe(false);
			const msg = result.errors.find((e) => e.includes("action"))!;
			expect(msg).toContain("enabled:false");
			expect(msg).toContain("update");
		}
	});

	it("action 为普通非法值时不附带禁用引导（避免误引导）", () => {
		const result = validateRule({
			comment: "bad",
			reason: "test",
			action: "explode",
		});
		expect(result.valid).toBe(false);
		const msg = result.errors.find((e) => e.includes("action"))!;
		expect(msg).not.toContain("enabled:false");
	});

	it("非法 hook 值报错", () => {
		const result = validateRule({
			comment: "bad hook",
			reason: "test",
			hook: "on_fire",
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("hook");
	});

	it("llmJudge 挂在非 message_end hook 报错（W2 修复）", () => {
		const result = validateRule({
			comment: "judge on tool_call",
			reason: "test",
			pattern: "foo",
			hook: "tool_call",
			llmJudge: { prompt: "判断" },
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("message_end"))).toBe(true);
	});

	it("llmJudge prompt 为空报错", () => {
		const result = validateRule({
			comment: "empty prompt",
			reason: "test",
			pattern: "foo",
			hook: "message_end",
			llmJudge: { prompt: "" },
		});
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes("prompt"))).toBe(true);
	});

	it("disabled: true 归一化为 enabled: false", () => {
		const rule = { comment: "test", reason: "test", disabled: true } as Record<
			string,
			unknown
		>;
		const result = validateRule(rule);
		expect(result.valid).toBe(true);
		expect(rule.disabled).toBeUndefined();
		expect(rule.enabled).toBe(false);
	});

	it("disabled: false 归一化为 enabled: true", () => {
		const rule = { comment: "test", reason: "test", disabled: false } as Record<
			string,
			unknown
		>;
		const result = validateRule(rule);
		expect(result.valid).toBe(true);
		expect(rule.disabled).toBeUndefined();
		expect(rule.enabled).toBe(true);
	});

	it("disabled 不覆盖已有的 enabled", () => {
		const rule = {
			comment: "test",
			reason: "test",
			enabled: true,
			disabled: true,
		} as Record<string, unknown>;
		const result = validateRule(rule);
		expect(result.valid).toBe(true);
		expect(rule.disabled).toBeUndefined();
		expect(rule.enabled).toBe(true); // 已有的 enabled 优先
	});

	it("partial 模式：changes 仅含 llmJudge（无 hook）不应报 hook 组合错误", () => {
		// 場景：update(index, changes={llmJudge: {...}}) 的 partial 校验——
		// changes 无 hook 字段，hook 校验应跳过（merged 完整校验会把关），
		// 曾因 `|| "tool_call"` 默认值误报“仅支持 message_end”（0.4.2 修复）
		const changes = {
			llmJudge: { prompt: "判断是否为无根据的归因猜测" },
		} as Record<string, unknown>;
		const result = validateRule(changes, { partial: true });
		expect(result.valid).toBe(true);
	});
});

// ── listRules ────────────────────────────────────────────

describe("listRules", () => {
	it("空文件返回空列表", () => {
		writeRules([]);
		const result = listRules(rulesPath);
		expect(result.rules).toEqual([]);
		expect(result.count).toBe(0);
	});

	it("正确列出所有规则含摘要", () => {
		writeRules([
			{
				comment: "rule 1",
				tool: "bash",
				action: "block",
				pattern: "rm",
				reason: "danger",
				enabled: true,
			},
			{
				comment: "rule 2",
				tool: "edit",
				action: "notify",
				pattern: "\\.py$",
				reason: "format",
			},
		]);
		const result = listRules(rulesPath);
		expect(result.count).toBe(2);
		expect(result.rules[0].index).toBe(0);
		expect(result.rules[0].comment).toBe("rule 1");
		expect(result.rules[0].enabled).toBe(true);
		expect(result.rules[1].index).toBe(1);
		expect(result.rules[1].enabled).toBeUndefined();
	});

	it("文件不存在返回空列表", () => {
		const result = listRules("/nonexistent/rules.json");
		expect(result.rules).toEqual([]);
		expect(result.count).toBe(0);
	});

	it("损坏 JSON 返回错误", () => {
		fs.writeFileSync(rulesPath, "{ broken", "utf-8");
		const result = listRules(rulesPath);
		expect(result.error).toBeTruthy();
	});

	it("非数组 JSON 返回错误", () => {
		fs.writeFileSync(rulesPath, '{"not":"array"}', "utf-8");
		const result = listRules(rulesPath);
		expect(result.error).toContain("数组");
	});
});
