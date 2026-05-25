/**
 * Guard 核心逻辑测试：getMatchTargets + ruleMatches + rewrite 规则
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { getMatchTargets, ruleMatches } from "@pi-atelier/shepherd";
import { makeRule } from "./helpers.js";

// ================================================================
// getMatchTargets
// ================================================================

describe("getMatchTargets", () => {
	it("should extract command from bash event", () => {
		const event = { input: { command: "git status" } };
		const result = getMatchTargets("bash", event);
		assert.equal(result.command, "git status");
		assert.equal(typeof result.path, "string");
		assert.equal(typeof result.text, "string");
	});

	it("should extract path and text from edit event with edits", () => {
		const event = {
			input: {
				path: "sizing/vol_target.py",
				edits: [
					{ oldText: "old code", newText: "from signals import foo" },
				],
			},
		};
		const result = getMatchTargets("edit", event);
		assert.equal(result.path, "sizing/vol_target.py");
		assert.ok(result.text.includes("from signals import foo"));
	});

	it("should extract path and text from write event", () => {
		const event = {
			input: {
				path: "signals/base.py",
				content: "from sizing import foo",
			},
		};
		const result = getMatchTargets("write", event);
		assert.equal(result.path, "signals/base.py");
		assert.ok(result.text.includes("from sizing import foo"));
	});

	it("should handle empty input gracefully", () => {
		const result = getMatchTargets("edit", { input: {} });
		assert.equal(result.path, "");
		assert.equal(result.text, "");
	});

	it("should handle edit with empty edits array", () => {
		const event = { input: { path: "foo.py", edits: [] } };
		const result = getMatchTargets("edit", event);
		assert.equal(result.path, "foo.py");
		assert.equal(result.text, "");
	});

	// grep 工具测试
	it("should return non-empty targets for grep with code glob and in-scope path", () => {
		const event = { input: { path: process.cwd(), pattern: "myFunction", glob: "*.ts" } };
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
		assert.equal(result.glob, "*.ts");
		assert.equal(result.text, "myFunction");
	});

	it("should return non-empty targets for grep with no glob but path in cwd", () => {
		const event = { input: { path: process.cwd(), pattern: "myFunction" } };
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
	});

	it("should return empty targets for grep with non-code glob", () => {
		const event = { input: { path: process.cwd(), pattern: "TODO", glob: "*.md" } };
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length === 0);
	});

	it("should return non-empty targets for grep with code glob regardless of path", () => {
		const event = { input: { path: "/tmp/some/dir", pattern: "myFunction", glob: "*.ts" } };
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
	});

	it("should return non-empty targets for grep with no glob regardless of path", () => {
		const event = { input: { path: "/tmp/some/dir", pattern: "myFunction" } };
		const result = getMatchTargets("grep", event);
		assert.ok(Object.keys(result).length > 0);
	});
});

// ================================================================
// ruleMatches
// ================================================================

describe("ruleMatches", () => {
	it("should match single condition pattern (path)", () => {
		const rule = makeRule({ _compiled: /\.py$/ });
		const targets = { path: "sizing/vol_target.py", text: "" };
		assert.ok(ruleMatches(rule, "edit", targets));
	});

	it("should NOT match single condition pattern", () => {
		const rule = makeRule({ _compiled: /\.rs$/ });
		const targets = { path: "sizing/vol_target.py", text: "" };
		assert.ok(!ruleMatches(rule, "edit", targets));
	});

	it("should match multi-condition AND (path + text)", () => {
		const rule = makeRule({
			conditions: [
				{ field: "path", pattern: "sizing/.*\\.py$", flags: "", _compiled: /sizing\/.*\.py$/ },
				{ field: "text", pattern: "from signals\\.|import signals", flags: "", _compiled: /from signals\.|import signals/ },
			],
		});
		const targets = { path: "sizing/vol_target.py", text: "from signals.cluster import compute" };
		assert.ok(ruleMatches(rule, "edit", targets));
	});

	it("should NOT match multi-condition when text condition fails", () => {
		const rule = makeRule({
			conditions: [
				{ field: "path", pattern: "sizing/.*\\.py$", flags: "", _compiled: /sizing\/.*\.py$/ },
				{ field: "text", pattern: "from signals\\.|import signals", flags: "", _compiled: /from signals\.|import signals/ },
			],
		});
		const targets = { path: "sizing/vol_target.py", text: "from dataclasses import dataclass" };
		assert.ok(!ruleMatches(rule, "edit", targets));
	});

	it("should NOT match multi-condition when path condition fails", () => {
		const rule = makeRule({
			conditions: [
				{ field: "path", pattern: "signals/.*\\.py$", flags: "", _compiled: /signals\/.*\.py$/ },
				{ field: "text", pattern: "from sizing\\.|import sizing", flags: "", _compiled: /from sizing\.|import sizing/ },
			],
		});
		const targets = { path: "sizing/vol_target.py", text: "from sizing import compute" };
		assert.ok(!ruleMatches(rule, "edit", targets));
	});

	it("should return false when conditions array is empty", () => {
		const rule = makeRule({ conditions: [] });
		assert.ok(!ruleMatches(rule, "edit", { path: "foo.py", text: "bar" }));
	});

	it("should return false when no pattern nor conditions are set", () => {
		const rule = makeRule({ pattern: undefined, _compiled: undefined, conditions: undefined });
		assert.ok(!ruleMatches(rule, "edit", { path: "foo.py", text: "bar" }));
	});

	it("should match bash command with single pattern", () => {
		const rule = makeRule({ tool: "bash", _compiled: /git\s+status/ });
		assert.ok(ruleMatches(rule, "bash", { command: "git status", path: "", text: "" }));
	});

	it("should extract text from all edits combined", () => {
		const rule = makeRule({
			conditions: [
				{ field: "text", pattern: "DynSizer", flags: "", _compiled: /DynSizer/ },
			],
		});
		assert.ok(ruleMatches(rule, "edit", { path: "engine.rs", text: "use DynSizer from crate" }));
	});
});

// ================================================================
// Rewrite 规则逻辑验证
// ================================================================

describe("rewrite rules", () => {
	it("should match git status command for rewrite", () => {
		const rule = makeRule({
			tool: "bash",
			action: "rewrite",
			_compiled: /^(git\s+(status|log|diff)|cargo\s+(test|build|clippy)|pytest)\b/,
		});
		assert.ok(ruleMatches(rule, "bash", { command: "git status", path: "", text: "" }));
	});

	it("should NOT match short commands like ls", () => {
		const rule = makeRule({
			tool: "bash",
			action: "rewrite",
			_compiled: /^(git\s+(status|log|diff)|cargo\s+(test|build|clippy)|pytest)\b/,
		});
		assert.ok(!ruleMatches(rule, "bash", { command: "ls -la", path: "", text: "" }));
	});

	it("should NOT match echo >> write commands", () => {
		const rule = makeRule({
			tool: "bash",
			action: "rewrite",
			_compiled: /^(git\s+(status|log|diff)|cargo\s+(test|build|clippy)|pytest)\b/,
		});
		assert.ok(!ruleMatches(rule, "bash", { command: "echo 'test' >> file.txt", path: "", text: "" }));
	});
});
