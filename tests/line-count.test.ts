/**
 * Guard line-count — 文件行数检查 — 单元测试
 *
 * 测试场景：
 * 1) 代码文件阈值：WARN(200) / MUST(300) / BAN(500)
 * 2) 记忆文件阈值：200 行
 * 3) 非检查扩展名跳过
 * 4) 文件不存在不抛异常
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { checkLineCount, drainHints, peekHints } from "@pi-atelier/shepherd";

// ── 测试辅助 ──────────────────────────────────────────────

const uid = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const tmpDir = path.join(os.tmpdir(), `shepherd-lc-${uid}`);

function createTempFile(relativePath: string, lines: number): string {
	const filePath = path.join(tmpDir, relativePath);
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const content = Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n");
	fs.writeFileSync(filePath, content, "utf-8");
	return filePath;
}

function cleanup() {
	try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** 调用 checkLineCount 后 drain 出 hints 文本（string | null） */
function checkAndDrain(filePath: string): string | null {
	checkLineCount(filePath);
	return drainHints();
}

describe("checkLineCount", () => {
	beforeEach(() => {
		cleanup();
		fs.mkdirSync(tmpDir, { recursive: true });
		drainHints(); // 清空缓冲区
	});

	afterEach(() => {
		cleanup();
	});

	// ── 代码文件行数检查 ────────────────────────────────────

	it("200 行以下不触发警告", () => {
		const filePath = createTempFile("small.ts", 50);
		const result = checkAndDrain(filePath);
		expect(result).toBeNull();
	});

	it("200-300 行触发 WARN 级别警告", () => {
		const filePath = createTempFile("moderate.ts", 250);
		const result = checkAndDrain(filePath);
		expect(result).toContain("⚠️");
		expect(result).toContain("250 行");
	});

	it("300-500 行触发 MUST 级别警告（必须拆分）", () => {
		const filePath = createTempFile("large.py", 350);
		const result = checkAndDrain(filePath);
		expect(result).toContain("🔴");
		expect(result).toContain("350 行");
		expect(result).toContain("必须拆分");
	});

	it("超过 500 行触发 BAN 级别警告（严禁）", () => {
		const filePath = createTempFile("huge.rs", 600);
		const result = checkAndDrain(filePath);
		expect(result).toContain("❌");
		expect(result).toContain("600 行");
		expect(result).toContain("严禁");
	});

	it("恰好 200 行应触发警告（≥200 是 WARN 阈值）", () => {
		const filePath = createTempFile("exact200.ts", 200);
		const result = checkAndDrain(filePath);
		expect(result).not.toBeNull();
	});

	// ── 记忆文件行数检查 ────────────────────────────────────

	it("记忆文件超过 200 行触发拆分提醒", () => {
		const filePath = createTempFile("memory/test_topic.md", 250);
		const result = checkAndDrain(filePath);
		expect(result).toContain("📝");
		expect(result).toContain("250 行");
		expect(result).toContain("必须拆分");
	});

	it("记忆文件 200 行以下不触发警告", () => {
		const filePath = createTempFile("memory/small_topic.md", 150);
		const result = checkAndDrain(filePath);
		expect(result).toBeNull();
	});

	// ── 非检查扩展名 ────────────────────────────────────────

	it("非检查扩展名不触发警告", () => {
		const filePath = createTempFile("data.json", 1000);
		const result = checkAndDrain(filePath);
		expect(result).toBeNull();
	});

	it("未识别的扩展名不触发警告", () => {
		const filePath = createTempFile("doc.docx", 5000);
		const result = checkAndDrain(filePath);
		expect(result).toBeNull();
	});

	// ── 文件不存在 ──────────────────────────────────────────

	it("文件不存在时不抛异常", () => {
		checkLineCount(path.join(tmpDir, "nonexistent.ts"));
		// 不抛异常且无警告
		expect(peekHints()).toBeNull();
	});

	// ── 边界值 ──────────────────────────────────────────────

	it("正好 500 行触发 BAN", () => {
		const filePath = createTempFile("boundary500.ts", 500);
		const result = checkAndDrain(filePath);
		expect(result).toContain("❌");
	});

	it("正好 300 行触发 MUST", () => {
		const filePath = createTempFile("boundary300.ts", 300);
		const result = checkAndDrain(filePath);
		expect(result).toContain("🔴");
	});
});
