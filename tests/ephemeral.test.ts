/**
 * Shepherd ephemeral — pushWarning + notifySummary — 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { pushWarning, notifySummary, hasWarnings } from "@pi-atelier/shepherd";
import { drainHints, peekHints, hasHints } from "@pi-atelier/shepherd";

function resetHints() { drainHints(); }

// ── pushWarning ───────────────────────────────────────────

describe("pushWarning", () => {
	beforeEach(resetHints);

	it("推入一条提示后 hasHints 为 true", () => {
		pushWarning("test warning message");
		expect(hasHints()).toBe(true);
	});

	it("提示内容包含 shepherd 前缀", () => {
		pushWarning("something went wrong");
		const hint = peekHints();
		expect(hint).toContain("⚠️ shepherd: ");
		expect(hint).toContain("something went wrong");
	});

	it("多次推入后 drainHints 返回全部内容", () => {
		pushWarning("first warning");
		pushWarning("second warning");
		const hints = drainHints();
		expect(hints).toContain("first warning");
		expect(hints).toContain("second warning");
		expect(hints!.split("\n\n").length).toBe(2);
	});

	it("drainHints 后缓冲区为空", () => {
		pushWarning("temp");
		drainHints();
		expect(hasHints()).toBe(false);
	});

	it("hasWarnings 同步反映缓冲状态", () => {
		expect(hasWarnings()).toBe(false);
		pushWarning("test");
		expect(hasWarnings()).toBe(true);
		drainHints();
		expect(hasWarnings()).toBe(false);
	});
});

// ── notifySummary ─────────────────────────────────────────

describe("notifySummary", () => {
	it("包含 --- 时截取分隔符之前的内容", () => {
		const text = "文件行数超限\n---\n拆分建议：提取公共函数";
		const result = notifySummary(text);
		expect(result).toBe("文件行数超限");
		expect(result).not.toContain("拆分建议");
	});

	it("无 --- 且长度 ≤ 120 时完整返回", () => {
		const text = "这是一个简短的摘要消息";
		const result = notifySummary(text);
		expect(result).toBe(text);
	});

	it("无 --- 且长度 > 120 时截断加省略号", () => {
		const text = "x".repeat(200);
		const result = notifySummary(text);
		expect(result.length).toBe(120);
		expect(result.endsWith("...")).toBe(true);
	});

	it("空字符串返回空字符串", () => {
		expect(notifySummary("")).toBe("");
	});

	it("正好 120 字符不截断", () => {
		const text = "a".repeat(120);
		const result = notifySummary(text);
		expect(result).toBe(text);
		expect(result.endsWith("...")).toBe(false);
	});

	it("121 字符截断加省略号", () => {
		const text = "a".repeat(121);
		const result = notifySummary(text);
		expect(result.length).toBe(120);
		expect(result.endsWith("...")).toBe(true);
	});
});
