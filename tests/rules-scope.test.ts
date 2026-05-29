/**
 * scope 参数 + 项目级读写测试
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock process.cwd() 为 tmpDir
let tmpDir: string;
let globalDir: string;
let projectExtDir: string;
let globalRulesPath: string;
let projectRulesPath: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-scope-"));
	globalDir = path.join(tmpDir, "global");
	projectExtDir = path.join(tmpDir, ".pi", "extensions");
	fs.mkdirSync(globalDir, { recursive: true });
	fs.mkdirSync(projectExtDir, { recursive: true });
	globalRulesPath = path.join(globalDir, "rules.json");
	projectRulesPath = path.join(projectExtDir, "shepherd-rules.json");
});

afterEach(() => {
	try {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	} catch {}
	vi.restoreAllMocks();
});

function writeGlobalRules(rules: object[]): void {
	fs.writeFileSync(globalRulesPath, JSON.stringify(rules, null, "\t"), "utf-8");
}

function writeProjectRules(rules: object[]): void {
	fs.writeFileSync(projectRulesPath, JSON.stringify(rules, null, "\t"), "utf-8");
}

function readGlobalRules(): object[] {
	return JSON.parse(fs.readFileSync(globalRulesPath, "utf-8"));
}

function readProjectRules(): object[] {
	return JSON.parse(fs.readFileSync(projectRulesPath, "utf-8"));
}

// ── 项目级路径推导 ──────────────────────────────────────

describe("getRulesFilePath", () => {
	it("scope=global 返回全局路径", async () => {
		const { getRulesFilePath } = await import("../shepherd/rules-tool-helpers");
		expect(getRulesFilePath("global", globalDir, tmpDir)).toBe(globalRulesPath);
	});

	it("scope=project 返回项目级路径", async () => {
		const { getRulesFilePath } = await import("../shepherd/rules-tool-helpers");
		expect(getRulesFilePath("project", globalDir, tmpDir)).toBe(projectRulesPath);
	});

	it("scope 未传时默认 global", async () => {
		const { getRulesFilePath } = await import("../shepherd/rules-tool-helpers");
		expect(getRulesFilePath(undefined, globalDir, tmpDir)).toBe(globalRulesPath);
	});
});

// ── list scope 标注 ─────────────────────────────────────

describe("listRulesByScope", () => {
	it("无 scope 时返回全局+项目合并列表，标注来源", async () => {
		writeGlobalRules([
			{ comment: "global rule 1", reason: "test", tool: "bash" },
		]);
		writeProjectRules([
			{ comment: "project rule 1", reason: "safety", tool: "write" },
		]);
		const { listRulesByScope } = await import("../shepherd/rules-tool-helpers");
		const result = listRulesByScope(globalDir, tmpDir);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ comment: "global rule 1", scope: "global", index: 0 });
		expect(result[1]).toMatchObject({ comment: "project rule 1", scope: "project", index: 0 });
	});

	it("scope=global 只返回全局规则", async () => {
		writeGlobalRules([{ comment: "g1", reason: "t", tool: "bash" }]);
		writeProjectRules([{ comment: "p1", reason: "t", tool: "write" }]);
		const { listRulesByScope } = await import("../shepherd/rules-tool-helpers");
		const result = listRulesByScope(globalDir, tmpDir, "global");
		expect(result).toHaveLength(1);
		expect(result[0].scope).toBe("global");
	});

	it("scope=project 只返回项目级规则", async () => {
		writeGlobalRules([{ comment: "g1", reason: "t", tool: "bash" }]);
		writeProjectRules([{ comment: "p1", reason: "t", tool: "write" }]);
		const { listRulesByScope } = await import("../shepherd/rules-tool-helpers");
		const result = listRulesByScope(globalDir, tmpDir, "project");
		expect(result).toHaveLength(1);
		expect(result[0].scope).toBe("project");
	});

	it("项目级文件不存在时不报错，只返回全局", async () => {
		writeGlobalRules([{ comment: "g1", reason: "t" }]);
		// 不创建 projectRulesPath
		const { listRulesByScope } = await import("../shepherd/rules-tool-helpers");
		const result = listRulesByScope(globalDir, tmpDir);
		expect(result).toHaveLength(1);
		expect(result[0].scope).toBe("global");
	});
});

// ── add scope 分发 ──────────────────────────────────────

describe("addRule scope 分发", () => {
	it("scope=global 写入全局文件", async () => {
		writeGlobalRules([]);
		const { getRulesFilePath } = await import("../shepherd/rules-tool-helpers");
		const filePath = getRulesFilePath("global", globalDir, tmpDir);
		const { addRule } = await import("../shepherd/rules-editor");
		const result = addRule(filePath, { comment: "test", reason: "r", tool: "bash", pattern: "rm" });
		expect(result.success).toBe(true);
		expect(readGlobalRules()).toHaveLength(1);
	});

	it("scope=project 写入项目级文件（自动创建目录）", async () => {
		const { getRulesFilePath } = await import("../shepherd/rules-tool-helpers");
		const filePath = getRulesFilePath("project", globalDir, tmpDir);
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		const { addRule } = await import("../shepherd/rules-editor");
		const result = addRule(filePath, { comment: "test", reason: "r", tool: "write", pattern: "\\.env" });
		expect(result.success).toBe(true);
		expect(readProjectRules()).toHaveLength(1);
	});
});

// ── 跨 scope warning ────────────────────────────────────

describe("跨 scope 去重 warning", () => {
	it("add 到 project 时全局已有同签名规则，返回 warning", async () => {
		writeGlobalRules([
			{ comment: "existing", reason: "r", tool: "bash", pattern: "rm -rf" },
		]);
		writeProjectRules([]);
		const { checkCrossScopeDuplicate } = await import("../shepherd/rules-tool-helpers");
		const warning = checkCrossScopeDuplicate(
			"project", globalDir, tmpDir,
			{ tool: "bash", pattern: "rm -rf" },
		);
		expect(warning).toContain("全局已有相似规则");
	});

	it("add 到 global 时项目级已有同签名规则，返回 warning", async () => {
		writeGlobalRules([]);
		writeProjectRules([
			{ comment: "existing", reason: "r", tool: "bash", pattern: "rm -rf" },
		]);
		const { checkCrossScopeDuplicate } = await import("../shepherd/rules-tool-helpers");
		const warning = checkCrossScopeDuplicate(
			"global", globalDir, tmpDir,
			{ tool: "bash", pattern: "rm -rf" },
		);
		expect(warning).toContain("项目级已有相似规则");
	});

	it("另一 scope 无重复时返回 null", async () => {
		writeGlobalRules([{ comment: "g", reason: "r", tool: "bash", pattern: "ls" }]);
		writeProjectRules([]);
		const { checkCrossScopeDuplicate } = await import("../shepherd/rules-tool-helpers");
		const warning = checkCrossScopeDuplicate(
			"project", globalDir, tmpDir,
			{ tool: "bash", pattern: "rm" },
		);
		expect(warning).toBeNull();
	});
});
