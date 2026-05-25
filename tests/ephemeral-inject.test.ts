/**
 * Guard ephemeral — pushHint / drainHints 生命周期 — 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { pushWarning } from "@pi-atelier/shepherd";
import {
	pushHint,
	hasHints,
	peekHints,
	drainHints,
} from "@pi-atelier/shepherd";

function resetHints() { drainHints(); }

// ── pushHint / peekHints / drainHints 基础 ────────────────

describe("pushHint / peekHints / drainHints", () => {
	beforeEach(resetHints);

	it("空缓冲区时 peekHints 返回 null", () => {
		expect(peekHints()).toBeNull();
	});

	it("空缓冲区时 drainHints 返回 null", () => {
		expect(drainHints()).toBeNull();
	});

	it("peekHints 不消费提示", () => {
		pushHint("hello");
		const first = peekHints();
		const second = peekHints();
		expect(first).toBe(second);
		expect(first).toContain("hello");
	});

	it("drainHints 消费后缓冲区为空", () => {
		pushHint("hello");
		drainHints();
		expect(peekHints()).toBeNull();
	});
});

// ── pushWarning / drainHints 流程 ─────────────────────────

describe("pushWarning → drainHints", () => {
	beforeEach(resetHints);

	it("pushWarning 带 shepherd 前缀", () => {
		pushWarning("test warning");
		const text = drainHints();
		expect(text).toContain("⚠️ shepherd:");
		expect(text).toContain("test warning");
	});

	it("多次 pushWarning 后 drainHints 全部取出", () => {
		pushWarning("first");
		pushWarning("second");
		const text = drainHints();
		expect(text).toContain("first");
		expect(text).toContain("second");
		expect(hasHints()).toBe(false);
	});

	it("pushWarning + pushHint 混合后 drainHints 全部取出", () => {
		pushWarning("shepherd warning");
		pushHint("custom hint");
		const text = drainHints();
		expect(text).toContain("shepherd warning");
		expect(text).toContain("custom hint");
	});
});
