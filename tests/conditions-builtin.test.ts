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

describe("not_question_ending — AI 不以问句结尾时才触发", () => {
	it("纯陈述句 → 返回 true（允许触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "好的，我来帮你修改这个文件。",
			}),
		).toBe(true);
	});

	it("以中文问号结尾 → 返回 false（抑制触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "你觉得这个方案怎么样？",
			}),
		).toBe(false);
	});

	it("以英文问号结尾 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "What do you think?",
			}),
		).toBe(false);
	});

	it("以\"吗\"结尾 → 返回 false（抑制触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "要我直接改吗？",
			}),
		).toBe(false);
	});

	it("以\"呢\"结尾 → 返回 false（抑制触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "还是先讨论下呢",
			}),
		).toBe(false);
	});

	it("以\"吧\"结尾 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "先这样吧",
			}),
		).toBe(false);
	});

	it("以\"嘛\"结尾 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "这样也可以嘛",
			}),
		).toBe(false);
	});

	it("以\"么\"结尾 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "要不要这样做么",
			}),
		).toBe(false);
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "是这样么",
			}),
		).toBe(false);
	});

	it("空文本 → 返回 true（不抑制）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "",
			}),
		).toBe(true);
		expect(
			matchBuiltinCondition("not_question_ending", {}),
		).toBe(true);
	});

	it("问号后有尾随空格/换行 → 返回 false（抑制触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "你觉得呢？  \n  ",
			}),
		).toBe(false);
	});

	it("问号后有空行再无内容 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "要我先讨论下？\n\n",
			}),
		).toBe(false);
	});

	it("中间有问号但末尾是陈述句 → 返回 true（允许触发）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "这个方案有几个问题？首先...\n好的，我来实现。",
			}),
		).toBe(true);
	});

	it("多行文本，最后一行是问句 → 返回 false", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "好的，方案已确认。\n\n你觉得这个方向 OK 吗？",
			}),
		).toBe(false);
	});

	it("引用块内包含问句 → 返回 false（宽松方案也检测引用块）", () => {
		expect(
			matchBuiltinCondition("not_question_ending", {
				lastAssistantText: "> 那要拆成两个工具吗？",
			}),
		).toBe(false);
	});
})
