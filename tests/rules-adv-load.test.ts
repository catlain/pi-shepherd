/**
 * rules.ts 高级场景 — 加载/匹配/配置 (不含 child_process mock)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	CODE_EXT_RE,
	compileRules,
	getMatchTargets,
	loadRules,
	loadRulesFromFile,
	ruleMatches,
	type Rule,
} from "@pi-atelier/shepherd";

const tmpDir = path.join(process.cwd(), ".pi", "extensions");

function rmTmp() {
	try { fs.rmSync(path.join(process.cwd(), ".pi"), { recursive: true, force: true }); } catch { /* ok */ }
}

// ── loadRules ────────────────────────────────────────────

describe("loadRules 项目级规则", () => {
	beforeAll(() => rmTmp());
	afterEach(() => rmTmp());
	afterAll(() => rmTmp());

	it("从 .pi/extensions/ 加载 shepherd-rules-*.json", () => {
		fs.mkdirSync(tmpDir, { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "shepherd-rules-block.json"), JSON.stringify([{ comment: "proj", pattern: "danger" }]), "utf-8");
		const rules = loadRules(undefined, { projectRulesPattern: "shepherd-rules-" });
		expect(rules).toHaveLength(1);
		expect(rules[0].comment).toBe("proj");
	});

	it("同时加载全局和项目级规则", () => {
		fs.mkdirSync(tmpDir, { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "shepherd-rules-extra.json"), JSON.stringify([{ comment: "extra", pattern: "test" }]), "utf-8");
		const globalDir = path.join(process.cwd(), "__test_global_rules");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(path.join(globalDir, "rules.json"), JSON.stringify([{ comment: "global", pattern: "g" }]), "utf-8");
		const rules = loadRules(globalDir, { projectRulesPattern: "shepherd-rules-" });
		expect(rules).toHaveLength(2);
		expect(rules.map((r) => r.comment).sort()).toEqual(["extra", "global"]);
		fs.rmSync(globalDir, { recursive: true, force: true });
	});

	it("项目级目录不存在时只加载全局规则", () => {
		rmTmp();
		const globalDir = path.join(process.cwd(), "__test_global_rules2");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(path.join(globalDir, "rules.json"), JSON.stringify([{ comment: "only-global", pattern: "g" }]), "utf-8");
		const rules = loadRules(globalDir);
		expect(rules).toHaveLength(1);
		expect(rules[0].comment).toBe("only-global");
		fs.rmSync(globalDir, { recursive: true, force: true });
	});

	it("项目级规则 JSON 格式错误时推 error 但不中断", () => {
		fs.mkdirSync(tmpDir, { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "shepherd-rules-bad.json"), "not json", "utf-8");
		const globalDir = path.join(process.cwd(), "__test_global_rules3");
		fs.mkdirSync(globalDir, { recursive: true });
		fs.writeFileSync(path.join(globalDir, "rules.json"), JSON.stringify([{ comment: "ok", pattern: "g" }]), "utf-8");
		const rules = loadRules(globalDir, { projectRulesPattern: "shepherd-rules-" });
		expect(rules).toHaveLength(1);
		expect(rules[0].comment).toBe("ok");
		fs.rmSync(globalDir, { recursive: true, force: true });
	});
});

// ── loadRulesFromFile 边界 ──────────────────────────────

describe("loadRulesFromFile 边界", () => {
	afterAll(() => rmTmp());

	it("顶层非数组时返回 error", () => {
		const fp = path.join(tmpDir, "rules.json");
		fs.mkdirSync(tmpDir, { recursive: true });
		fs.writeFileSync(fp, JSON.stringify({ comment: "not-array" }), "utf-8");
		const r = loadRulesFromFile(fp);
		expect(r.rules).toEqual([]);
		expect(r.error).toContain("顶层必须是 JSON 数组");
	});
});

// ── ruleMatches ───────────────────────────────────────────

describe("ruleMatches", () => {
	it("conditions AND 模式全满足时匹配", () => {
		const rule = compileRules([{ comment: "r", conditions: [{ field: "path", pattern: "\\.py$" }, { field: "text", pattern: "import\\s+os" }] }])[0];
		expect(ruleMatches(rule, "edit", { path: "src/main.py", text: "import os", command: "" })).toBe(true);
	});

	it("conditions AND 模式一条件不满足时不匹配", () => {
		const rule = compileRules([{ comment: "r", conditions: [{ field: "path", pattern: "\\.py$" }, { field: "text", pattern: "import\\s+os" }] }])[0];
		expect(ruleMatches(rule, "edit", { path: "src/main.ts", text: "import os", command: "" })).toBe(false);
	});

	it("单 pattern 匹配 bash command", () => {
		const rule = compileRules([{ comment: "r", pattern: "rm\\s+-rf", tool: "bash" }])[0];
		expect(ruleMatches(rule, "bash", { command: "rm -rf /", path: "", text: "" })).toBe(true);
	});

	it("单 pattern 匹配 edit path", () => {
		const rule = compileRules([{ comment: "r", pattern: "\\.env$", tool: "edit" }])[0];
		expect(ruleMatches(rule, "edit", { command: "", path: "/app/.env", text: "" })).toBe(true);
	});

	it("无 pattern 也无 conditions 时 return false", () => {
		const rule = compileRules([{ comment: "r", check: "has_edits", hook: "agent_end" }])[0];
		expect(ruleMatches(rule, "bash", { command: "", path: "", text: "" })).toBe(false);
	});

	// ── negate 条件 ───────────────────────────────────────────

	it("negate=true 时正则不匹配才算通过", () => {
		const rule = compileRules([{
			comment: "unwrap 但排除测试代码",
			conditions: [
				{ field: "path", pattern: "src/.*\\.rs$" },
				{ field: "text", pattern: "\\.(unwrap|expect)\\(" },
				{ field: "text", pattern: "#\\[cfg\\(test\\)]", negate: true },
			],
		}])[0];
		// 生产代码有 unwrap，且不包含 #[cfg(test)] → 匹配
		expect(ruleMatches(rule, "edit", { path: "src/logic/board.rs", text: "val.unwrap()", command: "" })).toBe(true);
		// 测试代码有 unwrap，包含 #[cfg(test)] → 不匹配（negate 取反）
		expect(ruleMatches(rule, "edit", { path: "src/logic/board.rs", text: "#[cfg(test)]\nval.unwrap()", command: "" })).toBe(false);
		// 没有 unwrap → 不匹配（第二个条件失败）
		expect(ruleMatches(rule, "edit", { path: "src/logic/board.rs", text: "val?", command: "" })).toBe(false);
	});

	it("negate=false（默认）行为不变", () => {
		const rule = compileRules([{
			comment: "简单测试",
			conditions: [
				{ field: "text", pattern: "hello" },
			],
		}])[0];
		expect(ruleMatches(rule, "edit", { path: "", text: "hello world", command: "" })).toBe(true);
		expect(ruleMatches(rule, "edit", { path: "", text: "goodbye", command: "" })).toBe(false);
	});
});

// ── CODE_EXT_RE ───────────────────────────────────────────

describe("CODE_EXT_RE", () => {
	it("匹配常见代码文件扩展名", () => {
		expect(CODE_EXT_RE.test("*.py")).toBe(true);
		expect(CODE_EXT_RE.test("*.rs")).toBe(true);
		expect(CODE_EXT_RE.test("*.ts")).toBe(true);
		expect(CODE_EXT_RE.test("*.js")).toBe(true);
		expect(CODE_EXT_RE.test("*.toml")).toBe(true);
		expect(CODE_EXT_RE.test("*.json")).toBe(true);
		expect(CODE_EXT_RE.test("Makefile")).toBe(false);
		expect(CODE_EXT_RE.test("*.css")).toBe(false);
		expect(CODE_EXT_RE.test("*.md")).toBe(false);
	});
});

// ── getMatchTargets grep ──────────────────────────────────

describe("getMatchTargets grep", () => {
	it("grep 提取 path/text/glob", () => {
		const r = getMatchTargets("grep", { input: { path: "src/", glob: "*.ts", pattern: "import" } });
		expect(r.path).toBe("src/");
		expect(r.text).toBe("import");
		expect(r.glob).toBe("*.ts");
	});

	it("glob 为代码扩展名时不短路", () => {
		const r = getMatchTargets("grep", { input: { path: "src/", glob: "*.ts", pattern: "import" } });
		expect(Object.keys(r).length).toBeGreaterThan(0);
	});

	it("glob 为非代码扩展名时返回空 targets", () => {
		const r = getMatchTargets("grep", { input: { path: "src/", glob: "*.md", pattern: "TODO" } });
		expect(Object.keys(r)).toHaveLength(0);
	});

	it("无 glob 时默认不短路", () => {
		const r = getMatchTargets("grep", { input: { path: ".", pattern: "TODO" } });
		expect(Object.keys(r).length).toBeGreaterThan(0);
	});
});

// ── getMatchTargets edit/write/bash ───────────────────────

describe("getMatchTargets edit/write/bash", () => {
	it("edit 提取 path 和 newText（不含 oldText）", () => {
		const r = getMatchTargets("edit", { input: { path: "main.ts", edits: [{ oldText: "var", newText: "const" }] } });
		expect(r.path).toBe("main.ts");
		expect(r.text).toContain("const");
		expect(r.text).not.toContain("var");
	});

	it("edit 修复违规引用时 text 不含旧引用", () => {
		// 回归：把 crate::render 改为 crate::data 时，text 不应包含 crate::render
		const r = getMatchTargets("edit", {
			input: {
				path: "src/logic/interaction.rs",
				edits: [{ oldText: "use crate::render::BoardBead;", newText: "use crate::data::BoardBead;" }],
			},
		});
		expect(r.text).toContain("crate::data");
		expect(r.text).not.toContain("crate::render");
	});

	it("write 提取 path 和 content", () => {
		const r = getMatchTargets("write", { input: { path: "new.ts", content: "log('hi')" } });
		expect(r.path).toBe("new.ts");
		expect(r.text).toBe("log('hi')");
	});

	it("bash 提取 command", () => {
		const r = getMatchTargets("bash", { input: { command: "ls -la" } });
		expect(r.command).toBe("ls -la");
	});
});
