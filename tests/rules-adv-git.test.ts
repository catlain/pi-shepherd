/**
 * rules.ts 高级场景 — git 辅助函数测试（mock execSync）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 必须在 vi.mock 前定义 hoisted 变量
const { mockedExecSync } = vi.hoisted(() => ({ mockedExecSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execSync: mockedExecSync }));

import { hasGitUncommittedChanges, isInWorktree } from "@pi-atelier/shepherd";

describe("hasGitUncommittedChanges mock", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("已跟踪文件改动时返回 true", () => {
		mockedExecSync.mockReturnValue(Buffer.from("M src/index.ts\n"));
		expect(hasGitUncommittedChanges()).toBe(true);
	});

	it("仅有未跟踪文件时返回 false", () => {
		mockedExecSync.mockReturnValue(Buffer.from("?? newfile.ts\n"));
		expect(hasGitUncommittedChanges()).toBe(false);
	});

	it("干净工作区返回 false", () => {
		mockedExecSync.mockReturnValue(Buffer.from(""));
		expect(hasGitUncommittedChanges()).toBe(false);
	});

	it("git 命令异常时返回 false", () => {
		mockedExecSync.mockImplementation(() => { throw new Error("git error"); });
		expect(hasGitUncommittedChanges()).toBe(false);
	});
});

describe("isInWorktree mock", () => {
	const ORIG_CWD = process.cwd;

	afterEach(() => {
		Object.defineProperty(process, "cwd", { value: ORIG_CWD, configurable: true });
	});

	it("CWD 含 /.worktrees/ 时返回 true", () => {
		Object.defineProperty(process, "cwd", { value: () => "/home/user/.worktrees/feature-x", configurable: true });
		expect(isInWorktree()).toBe(true);
	});

	it("gitDir===commonDir 时返回 false（非 worktree）", () => {
		Object.defineProperty(process, "cwd", { value: () => "/home/user/project", configurable: true });
		mockedExecSync.mockReturnValue(Buffer.from(".git"));
		// git --git-dir 被调 2 次，第二次 git --git-common-dir 返回相同值
		expect(isInWorktree()).toBe(false);
	});

	it("gitDir!==commonDir 且 gitDir!==.git 时返回 true（是 worktree）", () => {
		Object.defineProperty(process, "cwd", { value: () => "/home/user/project", configurable: true });
		let callCount = 0;
		mockedExecSync.mockImplementation(() => {
			callCount++;
			return callCount === 1 ? Buffer.from("/path/to/worktree/.git/worktrees/feature") : Buffer.from("/path/to/main/.git");
		});
		expect(isInWorktree()).toBe(true);
	});

	it("git 异常时返回 false", () => {
		Object.defineProperty(process, "cwd", { value: () => "/tmp", configurable: true });
		mockedExecSync.mockImplementation(() => { throw new Error("not a repo"); });
		expect(isInWorktree()).toBe(false);
	});
});
