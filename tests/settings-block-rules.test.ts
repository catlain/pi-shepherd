/**
 * settings.json block 规则测试
 * 
 * 验证规则 #32-#34 的匹配逻辑：
 * - edit settings.json → block
 * - write settings.json → block
 * - bash 含 settings.json → block
 * - read settings.json → 不拦截
 * - 其他文件 → 不拦截
 * - settings.json.bak → block
 * - 路径中的 settings.json → block（子目录）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rule } from "../shepherd/rules";
import { getMatchTargets, ruleMatches, compileRules } from "../shepherd/rules";
import type { ToolEvent } from "../shepherd/event-types";

// ====== 规则定义（与 rules.json 中 #32-#34 一致） ======

const settingsBlockRules: Rule[] = [
	{
		hook: "tool_call",
		tool: "edit",
		action: "block",
		comment: "[settings] 禁止 edit 直接修改 settings.json",
		reason: "直接编辑 settings.json 曾导致配置丢失。必须使用 patchSettingsSectionWithBackup 或 settings_rollback。",
		conditions: [{ field: "path", pattern: "settings\\.json$|settings\\.json\\.bak" }],
	} as Rule,
	{
		hook: "tool_call",
		tool: "write",
		action: "block",
		comment: "[settings] 禁止 write 直接修改 settings.json",
		reason: "直接编辑 settings.json 曾导致配置丢失。必须使用 patchSettingsSectionWithBackup 或 settings_rollback。",
		conditions: [{ field: "path", pattern: "settings\\.json$|settings\\.json\\.bak" }],
	} as Rule,
	{
		hook: "tool_call",
		tool: "bash",
		action: "block",
		comment: "[settings] 禁止 bash 直接修改 settings.json",
		reason: "直接编辑 settings.json 曾导致配置丢失。必须使用 patchSettingsSectionWithBackup 或 settings_rollback。",
		conditions: [{ field: "command", pattern: "settings\\.json" }],
	} as Rule,
];

// 编译规则（和 shepherd 引擎启动时一样）
compileRules(settingsBlockRules);

// ====== 辅助函数 ======

/** 模拟 tool_call 事件 */
function makeEvent(toolName: string, input: Record<string, unknown>): ToolEvent {
	return { toolName, input } as ToolEvent;
}

/** 测试某次操作是否被 block */
function isBlocked(toolName: string, input: Record<string, unknown>): boolean {
	const event = makeEvent(toolName, input);
	const targets = getMatchTargets(toolName, event, "tool_call");
	// targets 为空 = 不处理
	if (Object.keys(targets).length === 0) return false;
	const matched = settingsBlockRules.some((rule) => {
		if (rule.tool !== toolName) return false;
		return ruleMatches(rule, toolName, targets);
	});
	return matched;
}

// ====== 测试用例 ======

describe("settings.json block 规则", () => {
	describe("应该 block 的操作", () => {
		it("edit settings.json（绝对路径）", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/settings.json", edits: [] })).toBe(true);
		});

		it("edit settings.json（相对路径）", () => {
			expect(isBlocked("edit", { path: "settings.json", edits: [] })).toBe(true);
		});

		it("edit settings.json.bak", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/settings.json.bak", edits: [] })).toBe(true);
		});

		it("write settings.json（绝对路径）", () => {
			expect(isBlocked("write", { path: "/home/lain/.pi/agent/settings.json", content: "{}" })).toBe(true);
		});

		it("write settings.json（相对路径）", () => {
			expect(isBlocked("write", { path: "settings.json", content: "{}" })).toBe(true);
		});

		it("write settings.json.bak", () => {
			expect(isBlocked("write", { path: "settings.json.bak", content: "{}" })).toBe(true);
		});

		it("bash cat settings.json", () => {
			expect(isBlocked("bash", { command: "cat /home/lain/.pi/agent/settings.json" })).toBe(true);
		});

		it("bash python 写 settings.json", () => {
			expect(isBlocked("bash", { command: "python3 -c \"import json; json.dump({}, open('settings.json','w'))\"" })).toBe(true);
		});

		it("bash sed 修改 settings.json", () => {
			expect(isBlocked("bash", { command: "sed -i 's/foo/bar/' settings.json" })).toBe(true);
		});

		it("bash cd && 编辑 settings.json", () => {
			expect(isBlocked("bash", { command: "cd ~/.pi/agent && cat settings.json" })).toBe(true);
		});

		it("edit 子目录中的 settings.json", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/git/github.com/catlain/pi-shepherd/settings.json", edits: [] })).toBe(true);
		});
	});

	describe("不应该 block 的操作", () => {
		it("read settings.json（read 不在规则中）", () => {
			// read 工具没有对应的 block 规则
			const readRules = settingsBlockRules.filter((r) => r.tool === "read");
			expect(readRules).toHaveLength(0);
		});

		it("edit 其他 .json 文件", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/git/github.com/catlain/pi-shepherd/rules.json", edits: [] })).toBe(false);
		});

		it("edit ts 文件", () => {
			expect(isBlocked("edit", { path: "src/index.ts", edits: [] })).toBe(false);
		});

		it("write 其他文件", () => {
			expect(isBlocked("write", { path: "output.txt", content: "hello" })).toBe(false);
		});

		it("bash 不含 settings.json 的命令", () => {
			expect(isBlocked("bash", { command: "npm test" })).toBe(false);
		});

		it("bash git commit（含 message 但不含 settings.json）", () => {
			expect(isBlocked("bash", { command: "git commit -m 'fix: update config'" })).toBe(false);
		});

		it("edit settings.ts（不是 .json）", () => {
			expect(isBlocked("edit", { path: "settings.ts", edits: [] })).toBe(false);
		});

		it("edit my-settings.json（不以 settings.json 结尾）", () => {
			// 正则 settings\.json$ 匹配字符串末尾的 settings.json
			// my-settings.json 也以 settings.json 结尾！这会被匹配
			expect(isBlocked("edit", { path: "my-settings.json", edits: [] })).toBe(true);
		});

		it("bash 不含 settings.json 的 Python 脚本", () => {
			expect(isBlocked("bash", { command: "python3 -c \"print('hello')\"" })).toBe(false);
		});
	});

	describe("getMatchTargets 字段映射", () => {
		it("bash 返回 command 字段，path 为空", () => {
			const targets = getMatchTargets("bash", makeEvent("bash", { command: "cat foo.txt" }), "tool_call");
			expect(targets.command).toBe("cat foo.txt");
			expect(targets.path).toBe("");
		});

		it("edit 返回 path 字段，command 为空", () => {
			const targets = getMatchTargets("edit", makeEvent("edit", { path: "foo.ts", edits: [] }), "tool_call");
			expect(targets.path).toBe("foo.ts");
			expect(targets.command).toBe("");
		});

		it("write 返回 path 字段，command 为空", () => {
			const targets = getMatchTargets("write", makeEvent("write", { path: "bar.ts", content: "" }), "tool_call");
			expect(targets.path).toBe("bar.ts");
			expect(targets.command).toBe("");
		});

		it("bash git commit 在 tool_call 阶段返回空 targets", () => {
			const targets = getMatchTargets("bash", makeEvent("bash", { command: "git commit -m 'fix'" }), "tool_call");
			expect(Object.keys(targets)).toHaveLength(0);
		});

		it("bash git commit 在 tool_result 阶段返回非空 targets", () => {
			const targets = getMatchTargets("bash", makeEvent("bash", { command: "git commit -m 'fix'" }), "tool_result");
			expect(targets.command).toBe("git commit -m 'fix'");
		});
	});
});
