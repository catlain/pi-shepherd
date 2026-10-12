/**
 * D2 分层校验回归测试（fix-rules-update-validation Task 4）
 *
 * 覆盖 8-31 事故三场景：
 * 1. 存量含 conditions[].field:"command" 的规则 update 改 reason → 应成功
 *    （事故现场：旧连坐校验 + 校验列表缺 command 导致永久锁死）
 * 2. update 传非法 action（"disable"）→ 应拒绝
 * 3. 存量含历史非法字段 + 合法 changes → 应成功且带存量警告
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { updateRule } from "../shepherd/rules-editor";

let tmpDir: string;

function makeRulesFile(rules: unknown[]): string {
	tmpDir = mkdtempSync(join(tmpdir(), "shepherd-update-"));
	const filePath = join(tmpDir, "rules.json");
	writeFileSync(filePath, JSON.stringify(rules), "utf-8");
	return filePath;
}

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	}
});

describe("updateRule 分层校验（D2）", () => {
	it("存量 command field 规则：改 reason 成功（8-31 事故场景）", () => {
		const filePath = makeRulesFile([
			{
				comment: "r1",
				reason: "old reason",
				action: "notify",
				tool: "bash",
				hook: "tool_call",
				enabled: true,
				conditions: [{ field: "command", pattern: "git push.*--force" }],
			},
		]);
		const result = updateRule(filePath, 0, { reason: "new reason" });
		assert.ok(result.success, `应成功，实际: ${result.error ?? ""}`);
		assert.equal(result.warning, undefined, "合法存量不应有警告");
		const saved = JSON.parse(readFileSync(filePath, "utf-8"));
		assert.equal(saved[0].reason, "new reason");
		assert.equal(saved[0].conditions[0].field, "command", "存量 command 应保留");
	});

	it("changes 含非法 action（disable）→ 拒绝且不写入", () => {
		const filePath = makeRulesFile([
			{ comment: "r1", reason: "ok", action: "notify", enabled: true },
		]);
		const result = updateRule(filePath, 0, { action: "disable" });
		assert.ok(!result.success, "非法 action 应拒绝");
		assert.ok(result.error && result.error.includes("action"), "报错应指向 action");
		const saved = JSON.parse(readFileSync(filePath, "utf-8"));
		assert.equal(saved[0].action, "notify", "原规则不应被改写");
	});

	it("存量含历史非法字段 + 合法 changes → 成功且带存量警告", () => {
		const filePath = makeRulesFile([
			{
				comment: "r2",
				reason: "old",
				action: "notify",
				enabled: true,
				conditions: [{ field: "bogus_legacy", pattern: "x" }], // 历史遗留非法 field
			},
		]);
		const result = updateRule(filePath, 0, { reason: "fixed" });
		assert.ok(result.success, "存量非法不应阻塞合法 changes");
		assert.ok(result.warning && result.warning.includes("bogus_legacy"), "警告应指向存量字段");
		assert.ok(result.warning && result.warning.includes("update"), "警告应带修复指引");
		const saved = JSON.parse(readFileSync(filePath, "utf-8"));
		assert.equal(saved[0].reason, "fixed", "changes 应已写入");
	});

	it("changes 含非法 conditions field → 拒绝（partial 严格）", () => {
		const filePath = makeRulesFile([
			{ comment: "r3", reason: "ok", action: "notify", enabled: true },
		]);
		const result = updateRule(filePath, 0, {
			conditions: [{ field: "bogus", pattern: "x" }],
		});
		assert.ok(!result.success, "changes 中新引入的非法 field 应拒绝");
	});

	it("合法存量 + 合法 changes → 成功无警告（冒烟）", () => {
		const filePath = makeRulesFile([
			{ comment: "r4", reason: "ok", action: "notify", enabled: true },
		]);
		const result = updateRule(filePath, 0, { enabled: false });
		assert.ok(result.success);
		assert.equal(result.warning, undefined);
	});
});
