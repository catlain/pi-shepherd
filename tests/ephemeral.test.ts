/**
 * Shepherd ephemeral — pushWarning + notifySummary — 单元测试
 */

import {
	drainHints,
	hasHints,
	hasWarnings,
	notifySummary,
	peekHints,
	pushWarning,
} from "@pi-atelier/shepherd";
import { beforeEach, describe, expect, it } from "vitest";

function resetHints() {
	drainHints();
}

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

	it("替换 ${PI_SESSION_ID} 环境变量", () => {
		process.env.PI_SESSION_ID = "test-session-123";
		pushWarning("session:${PI_SESSION_ID}");
		const hint = drainHints();
		expect(hint).toContain("test-session-123");
		expect(hint).not.toContain("${PI_SESSION_ID}");
		delete process.env.PI_SESSION_ID;
	});

	it("未定义的环境变量保留原始占位符", () => {
		pushWarning("value:${NONEXISTENT_VAR_12345}");
		const hint = drainHints();
		expect(hint).toContain("${NONEXISTENT_VAR_12345}");
	});

	it("不包含 \${} 的文本原样通过", () => {
		pushWarning("plain text no vars");
		const hint = drainHints();
		expect(hint).toContain("plain text no vars");
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
