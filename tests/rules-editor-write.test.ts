/**
 * addRule / updateRule / deleteRule — 写入操作测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addRule, deleteRule, updateRule } from "../shepherd/rules-editor";

let tmpDir: string;
let rulesPath: string;
let backupPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-editor-"));
	rulesPath = path.join(tmpDir, "rules.json");
	backupPath = `${rulesPath}.bak`;
});

afterEach(() => {
	try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function writeRules(rules: object[]): void {
	fs.writeFileSync(rulesPath, JSON.stringify(rules, null, "\t"), "utf-8");
}

function readRulesFile(): object[] {
	return JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
}

// ── addRule ──────────────────────────────────────────────

describe("addRule", () => {
	it("正常添加规则到空文件", () => {
		writeRules([]);
		const result = addRule(rulesPath, { comment: "new rule", reason: "safety", pattern: "rm -rf", action: "block" });
		expect(result.success).toBe(true);
		expect(result.index).toBe(0);
		expect(readRulesFile()).toHaveLength(1);
		expect((readRulesFile()[0] as any).comment).toBe("new rule");
	});

	it("追加到已有规则末尾", () => {
		writeRules([{ comment: "existing", reason: "test", tool: "bash" }]);
		const result = addRule(rulesPath, { comment: "new", reason: "safety", tool: "write" });
		expect(result.success).toBe(true);
		expect(result.index).toBe(1);
		expect(readRulesFile()).toHaveLength(2);
	});

	it("缺少 comment 拒绝", () => {
		writeRules([]);
		const result = addRule(rulesPath, { reason: "no comment", pattern: "foo" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("comment");
		expect(readRulesFile()).toHaveLength(0);
	});

	it("缺少 reason 拒绝", () => {
		writeRules([]);
		const result = addRule(rulesPath, { comment: "no reason", pattern: "foo" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("reason");
	});

	it("无效正则 pattern 拒绝", () => {
		writeRules([]);
		const result = addRule(rulesPath, { comment: "bad", reason: "test", pattern: "[invalid" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("正则");
	});

	it("添加前自动创建备份", () => {
		const original = [{ comment: "orig", reason: "test" }];
		writeRules(original);
		addRule(rulesPath, { comment: "new", reason: "test" });
		expect(fs.existsSync(backupPath)).toBe(true);
		expect(JSON.parse(fs.readFileSync(backupPath, "utf-8"))).toEqual(original);
	});

	it("文件不存在时自动创建", () => {
		expect(fs.existsSync(rulesPath)).toBe(false);
		const result = addRule(rulesPath, { comment: "first", reason: "create" });
		expect(result.success).toBe(true);
		expect(readRulesFile()).toHaveLength(1);
	});

	it("非数组 JSON 报错", () => {
		fs.writeFileSync(rulesPath, '{"not":"array"}', "utf-8");
		const result = addRule(rulesPath, { comment: "try", reason: "test" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("数组");
	});
});

// ── updateRule ───────────────────────────────────────────

describe("updateRule", () => {
	it("部分更新：只改 reason", () => {
		writeRules([{ comment: "r1", reason: "old", pattern: "foo", action: "block" }]);
		updateRule(rulesPath, 0, { reason: "new" });
		const r = readRulesFile()[0] as any;
		expect(r.reason).toBe("new");
		expect(r.pattern).toBe("foo");
		expect(r.action).toBe("block");
	});

	it("更新 enabled 状态", () => {
		writeRules([{ comment: "r1", reason: "test", enabled: true }]);
		updateRule(rulesPath, 0, { enabled: false });
		expect((readRulesFile()[0] as any).enabled).toBe(false);
	});

	it("更新 pattern", () => {
		writeRules([{ comment: "r1", reason: "test", pattern: "old" }]);
		updateRule(rulesPath, 0, { pattern: "new\\.pat" });
		expect((readRulesFile()[0] as any).pattern).toBe("new\\.pat");
	});

	it("编号越界拒绝", () => {
		writeRules([{ comment: "only", reason: "test" }]);
		const result = updateRule(rulesPath, 5, { reason: "nope" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("越界");
	});

	it("负数编号拒绝", () => {
		writeRules([{ comment: "only", reason: "test" }]);
		const result = updateRule(rulesPath, -1, { reason: "nope" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("越界");
	});

	it("更新为无效正则拒绝且文件不变", () => {
		writeRules([{ comment: "r1", reason: "test", pattern: "valid" }]);
		const result = updateRule(rulesPath, 0, { pattern: "[broken" });
		expect(result.success).toBe(false);
		expect((readRulesFile()[0] as any).pattern).toBe("valid");
	});

	it("更新 conditions 无效正则拒绝", () => {
		writeRules([{ comment: "r1", reason: "test" }]);
		const result = updateRule(rulesPath, 0, { conditions: [{ field: "path", pattern: "[broken" }] });
		expect(result.success).toBe(false);
		expect(result.error).toContain("conditions");
	});

	it("更新前自动创建备份", () => {
		const original = [{ comment: "orig", reason: "test" }];
		writeRules(original);
		updateRule(rulesPath, 0, { reason: "updated" });
		expect(fs.existsSync(backupPath)).toBe(true);
		expect(JSON.parse(fs.readFileSync(backupPath, "utf-8"))).toEqual(original);
	});
});

// ── deleteRule ───────────────────────────────────────────

describe("deleteRule", () => {
	it("正常删除中间规则", () => {
		writeRules([
			{ comment: "r1", reason: "a" },
			{ comment: "r2", reason: "b" },
			{ comment: "r3", reason: "c" },
		]);
		const result = deleteRule(rulesPath, 1);
		expect(result.success).toBe(true);
		expect(result.deleted?.comment).toBe("r2");
		const rules = readRulesFile();
		expect(rules).toHaveLength(2);
		expect((rules[0] as any).comment).toBe("r1");
		expect((rules[1] as any).comment).toBe("r3");
	});

	it("删除唯一规则后为空数组", () => {
		writeRules([{ comment: "only", reason: "test" }]);
		const result = deleteRule(rulesPath, 0);
		expect(result.success).toBe(true);
		expect(readRulesFile()).toEqual([]);
	});

	it("编号越界拒绝", () => {
		writeRules([{ comment: "only", reason: "test" }]);
		expect(deleteRule(rulesPath, 99).success).toBe(false);
		expect(deleteRule(rulesPath, -1).success).toBe(false);
	});

	it("删除前自动创建备份", () => {
		const original = [{ comment: "orig", reason: "test" }];
		writeRules(original);
		deleteRule(rulesPath, 0);
		expect(JSON.parse(fs.readFileSync(backupPath, "utf-8"))).toEqual(original);
	});
});
