/**
 * 规则去重覆盖测试 — dedupKey + findDuplicateBySignature + addRule 覆盖逻辑
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addRule,
	dedupKey,
	findDuplicateBySignature,
} from "../shepherd/rules-editor";

let tmpDir: string;
let rulesPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-dedup-"));
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

function readRulesFile(): object[] {
	return JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
}

// ── dedupKey ─────────────────────────────────────────────

describe("dedupKey", () => {
	it("基本三元组 tool+hook+pattern 生成 key", () => {
		const key = dedupKey({
			tool: "bash",
			hook: "tool_call",
			pattern: "rm -rf",
		});
		expect(key).toBe("bash|tool_call|rm -rf|");
	});

	it("默认值填充：无 tool/hook/pattern/action 时用空串", () => {
		const key = dedupKey({});
		expect(key).toBe("|||");
	});

	it("conditions 模式：序列化条件数组", () => {
		const key = dedupKey({
			conditions: [
				{ field: "path", pattern: "\\.ts$" },
				{ field: "text", pattern: "TODO" },
			],
		});
		expect(key).toContain("path");
		expect(key).toContain("\\.ts$");
		expect(key).toContain("TODO");
	});

	it("check 字段替代 pattern", () => {
		const key = dedupKey({ hook: "agent_end", check: "git_uncommitted" });
		expect(key).toBe("|agent_end|git_uncommitted|");
	});

	it("action 参与签名：不同 action 产生不同 key", () => {
		const key1 = dedupKey({ tool: "bash", pattern: "rm", action: "block" });
		const key2 = dedupKey({ tool: "bash", pattern: "rm", action: "notify" });
		expect(key1).not.toBe(key2);
	});
});

// ── findDuplicateBySignature ──────────────────────────────

describe("findDuplicateBySignature", () => {
	it("空数组返回 null", () => {
		expect(
			findDuplicateBySignature([], { tool: "bash", pattern: "rm" }),
		).toBeNull();
	});

	it("找到签名相同的规则返回 index", () => {
		const rules = [
			{ comment: "r1", reason: "a", tool: "bash", pattern: "rm -rf" },
			{ comment: "r2", reason: "b", tool: "write", pattern: "\\.env" },
		];
		expect(
			findDuplicateBySignature(rules, { tool: "bash", pattern: "rm -rf" }),
		).toBe(0);
		expect(
			findDuplicateBySignature(rules, { tool: "write", pattern: "\\.env" }),
		).toBe(1);
	});

	it("签名不同返回 null", () => {
		const rules = [{ comment: "r1", reason: "a", tool: "bash", pattern: "rm" }];
		expect(
			findDuplicateBySignature(rules, { tool: "bash", pattern: "ls" }),
		).toBeNull();
	});

	it("conditions 规则去重", () => {
		const rules = [
			{
				comment: "r1",
				reason: "a",
				conditions: [{ field: "path", pattern: "\\.ts$" }],
			},
		];
		expect(
			findDuplicateBySignature(rules, {
				conditions: [{ field: "path", pattern: "\\.ts$" }],
			}),
		).toBe(0);
	});

	it("conditions 字段顺序不同也匹配（排序后比较）", () => {
		const rules = [
			{
				comment: "r1",
				reason: "a",
				conditions: [
					{ field: "path", pattern: "\\.ts$" },
					{ field: "text", pattern: "TODO" },
				],
			},
		];
		expect(
			findDuplicateBySignature(rules, {
				conditions: [
					{ field: "text", pattern: "TODO" },
					{ field: "path", pattern: "\\.ts$" },
				],
			}),
		).toBe(0);
	});
});

// ── addRule 去重覆盖 ──────────────────────────────────────

describe("addRule 去重覆盖", () => {
	it("新规则正常追加", () => {
		writeRules([{ comment: "existing", reason: "test" }]);
		const result = addRule(rulesPath, {
			comment: "new",
			reason: "safety",
			tool: "bash",
			pattern: "rm",
		});
		expect(result.success).toBe(true);
		expect(result.index).toBe(1);
		expect(readRulesFile()).toHaveLength(2);
	});

	it("签名重复时覆盖而非追加", () => {
		writeRules([
			{
				comment: "old comment",
				reason: "old reason",
				tool: "bash",
				pattern: "rm -rf",
				action: "block",
			},
			{ comment: "other", reason: "test", tool: "write", pattern: "\\.env" },
		]);
		const result = addRule(rulesPath, {
			comment: "updated comment",
			reason: "new reason",
			tool: "bash",
			pattern: "rm -rf",
			action: "block",
		});
		expect(result.success).toBe(true);
		expect(result.overwritten).toBe(true);
		expect(result.index).toBe(0);
		expect(readRulesFile()).toHaveLength(2); // 没有增加
		const rules = readRulesFile();
		expect((rules[0] as any).comment).toBe("updated comment");
		expect((rules[1] as any).comment).toBe("other"); // 不受影响
	});

	it("签名部分匹配不算重复（不同 action 不覆盖）", () => {
		writeRules([
			{
				comment: "block",
				reason: "r",
				tool: "bash",
				pattern: "rm",
				action: "block",
			},
		]);
		const result = addRule(rulesPath, {
			comment: "notify",
			reason: "r",
			tool: "bash",
			pattern: "rm",
			action: "notify",
		});
		expect(result.success).toBe(true);
		expect(result.overwritten).toBeUndefined();
		expect(readRulesFile()).toHaveLength(2); // 追加，不覆盖
	});

	it("check 规则去重", () => {
		writeRules([
			{
				comment: "old",
				reason: "r",
				hook: "agent_end",
				check: "git_uncommitted",
				action: "notify",
			},
		]);
		const result = addRule(rulesPath, {
			comment: "new",
			reason: "r",
			hook: "agent_end",
			check: "git_uncommitted",
			action: "notify",
		});
		expect(result.overwritten).toBe(true);
		expect(readRulesFile()).toHaveLength(1);
		expect((readRulesFile()[0] as any).comment).toBe("new");
	});
});
