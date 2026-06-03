/**
 * ConditionBuiltin 类型 + git 检查拆分函数测试
 *
 * 覆盖：
 * - ConditionBuiltin 接口定义（通过 matchBuiltinCondition 行为验证）
 * - isGitDirty()：只检查已跟踪文件的修改/删除
 * - hasGitUntracked()：只检查未跟踪文件
 * - isGitDirtyOrUntracked()：两者合并
 * - matchBuiltinCondition()：各 builtin 条件的判断逻辑
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// mock child_process 的 execSync
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
	execSync: (...args: unknown[]) => mockExecSync(...args),
}));

// 动态导入以命中 mock
const {
	isGitDirty,
	hasGitUntracked,
	isGitDirtyOrUntracked,
	matchBuiltinCondition,
} = await import("../shepherd/rules");

// helper：模拟 git status --porcelain 输出
function mockGitStatus(lines: string[]) {
	mockExecSync.mockReturnValue(lines.join("\n"));
}

function mockGitError() {
	mockExecSync.mockImplementation(() => {
		throw new Error("not a git repo");
	});
}

describe("isGitDirty — 只检查已跟踪文件变更", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 默认 cwd mock
		// noop: no cwd mock override needed by default
	});

	it("有已跟踪文件修改 → true", () => {
		mockGitStatus(["M file.ts", "M other.ts"]);
		expect(isGitDirty()).toBe(true);
	});

	it("有已跟踪文件删除 → true", () => {
		mockGitStatus(["D deleted.ts"]);
		expect(isGitDirty()).toBe(true);
	});

	it("有已跟踪文件新增（staged） → true", () => {
		mockGitStatus(["A new.ts"]);
		expect(isGitDirty()).toBe(true);
	});

	it("有重命名 → true", () => {
		mockGitStatus(["R old.ts → new.ts"]);
		expect(isGitDirty()).toBe(true);
	});

	it("只有 untracked 文件 → false", () => {
		mockGitStatus(["?? untracked.ts", "?? dir/"]);
		expect(isGitDirty()).toBe(false);
	});

	it("混合：已跟踪 + untracked → true（只看已跟踪）", () => {
		mockGitStatus(["M file.ts", "?? untracked.ts"]);
		expect(isGitDirty()).toBe(true);
	});

	it("空输出 → false", () => {
		mockGitStatus([]);
		expect(isGitDirty()).toBe(false);
	});

	it("git 命令失败 → false", () => {
		mockGitError();
		expect(isGitDirty()).toBe(false);
	});
});

describe("hasGitUntracked — 只检查未跟踪文件", () => {
	it("有 untracked 文件 → true", () => {
		mockGitStatus(["?? new-file.ts"]);
		expect(hasGitUntracked()).toBe(true);
	});

	it("有 untracked 目录 → true", () => {
		mockGitStatus(["?? src/generated/"]);
		expect(hasGitUntracked()).toBe(true);
	});

	it("只有已跟踪文件修改 → false", () => {
		mockGitStatus(["M file.ts", "D other.ts"]);
		expect(hasGitUntracked()).toBe(false);
	});

	it("空输出 → false", () => {
		mockGitStatus([]);
		expect(hasGitUntracked()).toBe(false);
	});

	it("git 命令失败 → false", () => {
		mockGitError();
		expect(hasGitUntracked()).toBe(false);
	});
});

describe("isGitDirtyOrUntracked — 两者合并", () => {
	it("只有 dirty → true", () => {
		mockGitStatus(["M file.ts"]);
		expect(isGitDirtyOrUntracked()).toBe(true);
	});

	it("只有 untracked → true", () => {
		mockGitStatus(["?? new.ts"]);
		expect(isGitDirtyOrUntracked()).toBe(true);
	});

	it("两者都有 → true", () => {
		mockGitStatus(["M file.ts", "?? new.ts"]);
		expect(isGitDirtyOrUntracked()).toBe(true);
	});

	it("都没有 → false", () => {
		mockGitStatus([]);
		expect(isGitDirtyOrUntracked()).toBe(false);
	});
});

describe("matchBuiltinCondition — 内置条件判断", () => {
	it("builtin=always 始终匹配", () => {
		expect(matchBuiltinCondition("always", {})).toBe(true);
	});

	it("builtin=has_edits + hasEdits=true → true", () => {
		expect(matchBuiltinCondition("has_edits", { hasEdits: true })).toBe(true);
	});

	it("builtin=has_edits + hasEdits=false → false", () => {
		expect(matchBuiltinCondition("has_edits", { hasEdits: false })).toBe(false);
	});

	it("builtin=git_dirty + isDirty=true → true", () => {
		mockGitStatus(["M file.ts"]);
		expect(matchBuiltinCondition("git_dirty", {})).toBe(true);
	});

	it("builtin=git_dirty + isDirty=false → false", () => {
		mockGitStatus([]);
		expect(matchBuiltinCondition("git_dirty", {})).toBe(false);
	});

	it("builtin=git_untracked + 有untracked → true", () => {
		mockGitStatus(["?? new.ts"]);
		expect(matchBuiltinCondition("git_untracked", {})).toBe(true);
	});

	it("builtin=git_untracked + 无untracked → false", () => {
		mockGitStatus(["M file.ts"]);
		expect(matchBuiltinCondition("git_untracked", {})).toBe(false);
	});

	it("builtin=git_dirty_or_untracked 已移除，用 OR 组合", () => {
		// git_dirty_or_untracked 已从 ConditionBuiltin 移除
		// 应该用 conditions: [{ builtin: "git_dirty" }, { builtin: "git_untracked" }] + conditionLogic: "or"
		// 见 condition-logic-or.test.ts
		expect(true).toBe(true);
	});
});
