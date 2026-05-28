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
	try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function writeRules(rules: object[]): void {
	fs.writeFileSync(rulesPath, JSON.stringify(rules, null, "\t"), "utf-8");
}

// ── validateRule ─────────────────────────────────────────

describe("validateRule", () => {
	it("合法规则通过校验", () => {
		const result = validateRule({ comment: "test rule", reason: "test reason", pattern: "foo\\.bar" });
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
		const result = validateRule({ comment: "bad regex", reason: "test", pattern: "[invalid" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("正则");
	});

	it("无效 flags 报错", () => {
		const result = validateRule({ comment: "bad flags", reason: "test", pattern: "foo", flags: "xyz" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("flags");
	});

	it("conditions 中无效正则报错", () => {
		const result = validateRule({
			comment: "bad cond", reason: "test",
			conditions: [{ field: "path", pattern: "[invalid" }],
		});
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("conditions[0]");
	});

	it("无 pattern 无 conditions 合法（agent_end check 类）", () => {
		const result = validateRule({ comment: "check", reason: "提醒", hook: "agent_end", check: "git_uncommitted" });
		expect(result.valid).toBe(true);
	});

	it("非法 action 值报错", () => {
		const result = validateRule({ comment: "bad action", reason: "test", action: "explode" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("action");
	});

	it("非法 hook 值报错", () => {
		const result = validateRule({ comment: "bad hook", reason: "test", hook: "on_fire" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("hook");
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
			{ comment: "rule 1", tool: "bash", action: "block", pattern: "rm", reason: "danger", enabled: true },
			{ comment: "rule 2", tool: "edit", action: "notify", pattern: "\\.py$", reason: "format" },
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
