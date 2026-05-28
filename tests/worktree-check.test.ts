/**
 * worktree-check.test.ts — 合并 & 未合并分支场景
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockedExecFileSync } = vi.hoisted(() => ({
	mockedExecFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFileSync: mockedExecFileSync }));
vi.mock("../shepherd/rules.js", () => ({
	isInWorktree: vi.fn(() => false),
	isSubagent: vi.fn(() => false),
}));

import { checkWorktrees } from "../shepherd/worktree-check";

// 创建临时 worktree 目录使 existsSync 返回 true
const TEST_WT = join(process.cwd(), ".worktrees", "feature-x");

describe("checkWorktrees", () => {
	beforeAll(() => {
		try { mkdirSync(join(process.cwd(), ".worktrees"), { recursive: true }); } catch {}
		try { mkdirSync(TEST_WT, { recursive: true }); } catch {}
	});
	afterAll(() => {
		try { rmSync(join(process.cwd(), ".worktrees"), { recursive: true, force: true }); } catch {}
	});
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── 无分支 ────────────────────────

	it("无 worktree/* 分支时不触发通知", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) =>
			a[0] === "branch" && a.includes("--list") ? "  main\n  dev\n" : "",
		);
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).not.toHaveBeenCalled();
	});

	it("branchList 为空时不触发通知", () => {
		mockedExecFileSync.mockReturnValue("");
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).not.toHaveBeenCalled();
	});

	// ── 已合并 ────────────────────────

	it("已合并 worktree 分支自动清理并通知", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feature-x\n";
			if (a[0] === "log") return "\n";
			if (a[0] === "rev-parse") return "abc123\n";
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(
			expect.stringContaining("自动清理了 1 个已合并 worktree"), "info",
		);
	});

	it("无 commit 的已合并分支不触发操作", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feature-x\n";
			if (a[0] === "log") return "\n";
			if (a[0] === "rev-parse") throw new Error("no revision");
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).not.toHaveBeenCalled();
	});

	// ── 未合并 ────────────────────────

	it("未合并分支触发 warning 通知", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feature-x\n";
			if (a[0] === "log" && a.includes("main..worktree/feature-x")) return "abc123\n";
			if (a[0] === "-C") return " M modified.ts\n";
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(expect.stringContaining("未合并 worktree"), "warning");
	});

	it("未合并分支无未提交改动时只显示 ahead 数", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feature-x\n";
			if (a[0] === "log" && a.includes("main..worktree/feature-x")) return "abc123\nabc124\n";
			if (a[0] === "-C") return "";
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(expect.stringContaining("2 个未合并提交"), "warning");
	});

	// ── 混合 ─────────────────────────

	it("已合并 + 未合并分支触发两种通知", () => {
		let logC = 0;
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/m\n  worktree/u\n";
			if (a[0] === "log") { logC++; return logC === 1 ? "\n" : "abc\n"; }
			if (a[0] === "rev-parse") return "abc123\n";
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(expect.stringContaining("自动清理"), "info");
		expect(n).toHaveBeenCalledWith(expect.stringContaining("未合并"), "warning");
	});

	it("多条未合并分支显示完整列表", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feat-a\n  worktree/feat-b\n";
			if (a[0] === "log") return "abc123\n";
			if (a[0] === "-C") return " M file.ts\n";
			return "";
		});
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(expect.stringContaining("2 个未合并 worktree"), "warning");
		expect(n).toHaveBeenCalledWith(expect.stringContaining("/worktree-merge"), "warning");
	});

	// ── 异常 ─────────────────────────

	it("git 异常时不抛异常", () => {
		mockedExecFileSync.mockImplementation(() => { throw new Error("fatal"); });
		const n = vi.fn();
		expect(() => checkWorktrees({ notify: n })).not.toThrow();
		expect(n).not.toHaveBeenCalled();
	});

	it("notify 为 undefined 时不报错", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/m\n";
			if (a[0] === "log") return "\n";
			if (a[0] === "rev-parse") return "abc\n";
			return "";
		});
		expect(() => checkWorktrees({})).not.toThrow();
	});

	// ── fs fallback ───────────────────

	it("git worktree remove 失败时用 fs rmSync（目录存在时）", () => {
		mockedExecFileSync.mockImplementation((_c: string, a: string[]) => {
			if (a[0] === "branch" && a.includes("--list")) return "  worktree/feature-x\n";
			if (a[0] === "log") return "\n";
			if (a[0] === "rev-parse") return "abc123\n";
			if (a[0] === "worktree" && a[1] === "remove") throw new Error("fail");
			return "";
		});
		// 确保 worktree 目录存在（已在 beforeAll 创建）
		const n = vi.fn();
		checkWorktrees({ notify: n });
		expect(n).toHaveBeenCalledWith(expect.stringContaining("自动清理"), "info");
	});
});
