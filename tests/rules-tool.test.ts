/**
 * rules-tool.ts 集成测试 — 验证工具 execute 胶水层的参数校验和输出格式
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRulesEditorTool } from "../shepherd/rules-tool";

/** 模拟 pi.registerTool，捕获 execute 回调供测试调用 */
function createMockPi() {
	let captured: {
		name: string;
		parameters: any;
		execute: (id: string, params: any) => Promise<string>;
	} | null = null;

	const pi = {
		registerTool: vi.fn((def: any) => {
			captured = { name: def.name, parameters: def.parameters, execute: def.execute };
		}),
	} as any;

	return {
		pi,
		getTool: () => captured!,
	};
}

describe("rules-tool 集成测试", () => {
	let tmpDir: string;
	let rulesPath: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherd-tool-"));
		rulesPath = path.join(tmpDir, "rules.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	async function callExecute(params: any): Promise<string> {
		const { pi, getTool } = createMockPi();
		registerRulesEditorTool(pi, rulesPath);
		const tool = getTool();
		expect(tool.name).toBe("shepherd_rules");
		return tool.execute("call-1", params);
	}

	// ── list ────────────────────────────────────────────

	it("list: 空文件返回提示", async () => {
		const result = await callExecute({ action: "list" });
		expect(result).toBe("暂无规则。");
	});

	it("list: 列出多条规则", async () => {
		fs.writeFileSync(rulesPath, JSON.stringify([
			{ comment: "规则A", reason: "r", action: "block", tool: "write" },
			{ comment: "规则B", reason: "r", action: "notify", enabled: false },
		]));
		const result = await callExecute({ action: "list" });
		expect(result).toContain("[0] 规则A — block on write");
		expect(result).toContain("[1] 规则B (disabled) — notify");
	});

	// ── add ─────────────────────────────────────────────

	it("add: 缺少 rule 参数拒绝", async () => {
		const result = await callExecute({ action: "add" });
		expect(result).toContain("❌");
		expect(result).toContain("rule 参数");
	});

	it("add: 正常添加并返回编号", async () => {
		const result = await callExecute({
			action: "add",
			rule: { comment: "新规则", reason: "安全" },
		});
		expect(result).toBe("✅ 规则已添加 [0]");
		const written = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
		expect(written).toHaveLength(1);
		expect(written[0].comment).toBe("新规则");
	});

	it("add: 缺少必填字段被校验拒绝", async () => {
		const result = await callExecute({
			action: "add",
			rule: { comment: "只有comment" },
		});
		expect(result).toContain("❌");
		expect(result).toContain("reason");
	});

	// ── update ──────────────────────────────────────────

	it("update: 缺少 index 参数拒绝", async () => {
		const result = await callExecute({ action: "update", changes: {} });
		expect(result).toContain("❌");
		expect(result).toContain("index");
	});

	it("update: 缺少 changes 参数拒绝", async () => {
		const result = await callExecute({ action: "update", index: 0 });
		expect(result).toContain("❌");
		expect(result).toContain("changes");
	});

	it("update: 正常更新", async () => {
		fs.writeFileSync(rulesPath, JSON.stringify([
			{ comment: "旧", reason: "r", action: "block" },
		]));
		const result = await callExecute({
			action: "update",
			index: 0,
			changes: { action: "notify" },
		});
		expect(result).toBe("✅ 规则 [0] 已更新");
		const written = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
		expect(written[0].action).toBe("notify");
		expect(written[0].comment).toBe("旧"); // 未改的字段保留
	});

	// ── delete ──────────────────────────────────────────

	it("delete: 缺少 index 参数拒绝", async () => {
		const result = await callExecute({ action: "delete" });
		expect(result).toContain("❌");
		expect(result).toContain("index");
	});

	it("delete: 正常删除并返回名称", async () => {
		fs.writeFileSync(rulesPath, JSON.stringify([
			{ comment: "规则1", reason: "r" },
			{ comment: "规则2", reason: "r" },
		]));
		const result = await callExecute({ action: "delete", index: 0 });
		expect(result).toBe("✅ 规则已删除: 规则1");
		const written = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
		expect(written).toHaveLength(1);
		expect(written[0].comment).toBe("规则2");
	});

	it("delete: 编号越界拒绝", async () => {
		fs.writeFileSync(rulesPath, JSON.stringify([{ comment: "X", reason: "r" }]));
		const result = await callExecute({ action: "delete", index: 5 });
		expect(result).toContain("❌");
		expect(result).toContain("越界");
	});

	// ── 参数校验 ─────────────────────────────────────────

	it("parameters schema 包含 action enum", () => {
		const { pi, getTool } = createMockPi();
		registerRulesEditorTool(pi, "/dummy/path");
		const tool = getTool();
		expect(tool.parameters.required).toContain("action");
		expect(tool.parameters.properties.action.enum).toEqual(["list", "add", "update", "delete"]);
	});
});
