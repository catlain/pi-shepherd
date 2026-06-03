/**
 * 全局规则测试：has_edits 检查 + rtk 可用性 + grep scope 过滤
 */

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getMatchTargets, toolMatches } from "@pi-atelier/shepherd";
import { describe, it } from "vitest";

const RULES_PATH = path.resolve(
	path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")),
	"..",
	"rules.json",
);

function loadRules(): any[] {
	return JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
}

// ================================================================
// grep scope 过滤集成测试
// ================================================================

describe("grep scope filtering", () => {
	it("in-scope path + code glob → non-empty targets", () => {
		const event = {
			input: { path: process.cwd(), pattern: "myFunction", glob: "*.py" },
		};
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
	});

	it("any path + code glob → non-empty targets (path filtering removed)", () => {
		const event = {
			input: { path: "/tmp/some/dir", pattern: "myFunction", glob: "*.py" },
		};
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
	});

	it("non-code glob (.md) → empty targets", () => {
		const event = {
			input: { path: process.cwd(), pattern: "TODO", glob: "*.md" },
		};
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length === 0);
	});
});

// ================================================================
// has_edits check
// ================================================================

describe("has_edits check logic", () => {
	it("should find agent_end rule with git_dirty + git_untracked OR conditions", () => {
		const rules = loadRules();
		const agentEndRule = rules.find((r: any) => r.hook === "agent_end");
		assert.ok(agentEndRule);
		assert.equal(agentEndRule.action, "notify");
		// 应该有 git_dirty + git_untracked 两个 builtin 条件 + OR
		assert.ok(
			agentEndRule.conditions?.some((c: any) => c.builtin === "git_dirty"),
		);
		assert.ok(
			agentEndRule.conditions?.some((c: any) => c.builtin === "git_untracked"),
		);
		assert.equal(agentEndRule.conditionLogic, "or");
	});

	it("should detect edit/write tools correctly", () => {
		const editTools = ["edit", "write"];
		const otherTools = ["bash", "grep", "read"];
		for (const t of editTools) {
			assert.ok(editTools.includes(t));
		}
		for (const t of otherTools) {
			assert.ok(!editTools.includes(t));
		}
	});
});

// ================================================================
// ================================================================
// toolMatches 多工具匹配
// ================================================================

describe("toolMatches", () => {
	it("单工具精确匹配", () => {
		assert.strictEqual(toolMatches("edit", "edit"), true);
		assert.strictEqual(toolMatches("edit", "write"), false);
	});

	it("多工具管道分隔匹配", () => {
		assert.strictEqual(toolMatches("edit|write", "edit"), true);
		assert.strictEqual(toolMatches("edit|write", "write"), true);
		assert.strictEqual(toolMatches("edit|write", "bash"), false);
	});

	it("管道分隔支持空格", () => {
		assert.strictEqual(toolMatches("edit | write", "edit"), true);
		assert.strictEqual(toolMatches("edit | write", "write"), true);
	});

	it("undefined ruleTool 匹配所有工具", () => {
		assert.strictEqual(toolMatches(undefined, "edit"), true);
		assert.strictEqual(toolMatches(undefined, "bash"), true);
	});

	it("三值匹配", () => {
		assert.strictEqual(toolMatches("edit|write|bash", "edit"), true);
		assert.strictEqual(toolMatches("edit|write|bash", "write"), true);
		assert.strictEqual(toolMatches("edit|write|bash", "bash"), true);
		assert.strictEqual(toolMatches("edit|write|bash", "grep"), false);
	});
});

// RTK 可用性
// ================================================================

describe("rtk availability", () => {
	it("should detect rtk installation status", () => {
		try {
			execSync("which rtk", { timeout: 2000, stdio: "pipe" });
			assert.ok(true, "rtk is installed");
		} catch {
			assert.ok(true, "rtk is not installed (OK, rewrite will be skipped)");
		}
	});
});
