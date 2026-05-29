/**
 * settings.json block 规则测试
 * 
 * 验证规则 #32-#34 的匹配逻辑：
 * - edit settings.json → block
 * - write settings.json → block
 * - bash 写入 settings.json → block（只匹配写操作，不拦截 cat/grep 等读操作）
 * - read settings.json → 不拦截（无对应规则）
 * - 其他文件 → 不拦截
 */

import { describe, expect, it } from "vitest";
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
		comment: "[settings] 禁止 bash 写入 settings.json",
		reason: "直接编辑 settings.json 曾导致配置丢失。必须使用 patchSettingsSectionWithBackup 或 settings_rollback。",
		conditions: [{ field: "command", pattern: "(>>|>|tee|sed\\s+-i|cp\\s|mv\\s).*settings\\.json|settings\\.json\\s*(>>|>)" }],
	} as Rule,
];

// 编译规则（和 shepherd 引擎启动时一样）
compileRules(settingsBlockRules);

// ====== 辅助函数 ======

function makeEvent(toolName: string, input: Record<string, unknown>): ToolEvent {
	return { toolName, input } as ToolEvent;
}

function isBlocked(toolName: string, input: Record<string, unknown>): boolean {
	const event = makeEvent(toolName, input);
	const targets = getMatchTargets(toolName, event, "tool_call");
	if (Object.keys(targets).length === 0) return false;
	return settingsBlockRules.some((rule) => {
		if (rule.tool !== toolName) return false;
		return ruleMatches(rule, toolName, targets);
	});
}

// ====== 测试用例 ======

describe("settings.json block 规则", () => {
	describe("应该 block 的操作", () => {
		// --- edit ---
		it("edit settings.json（绝对路径）", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/settings.json", edits: [] })).toBe(true);
		});

		it("edit settings.json（相对路径）", () => {
			expect(isBlocked("edit", { path: "settings.json", edits: [] })).toBe(true);
		});

		it("edit settings.json.bak", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/settings.json.bak", edits: [] })).toBe(true);
		});

		it("edit 子目录中的 settings.json", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/git/github.com/catlain/pi-shepherd/settings.json", edits: [] })).toBe(true);
		});

		// --- write ---
		it("write settings.json（绝对路径）", () => {
			expect(isBlocked("write", { path: "/home/lain/.pi/agent/settings.json", content: "{}" })).toBe(true);
		});

		it("write settings.json（相对路径）", () => {
			expect(isBlocked("write", { path: "settings.json", content: "{}" })).toBe(true);
		});

		it("write settings.json.bak", () => {
			expect(isBlocked("write", { path: "settings.json.bak", content: "{}" })).toBe(true);
		});

		// --- bash 写操作 ---
		it("bash echo 重定向写入 settings.json", () => {
			expect(isBlocked("bash", { command: "echo '{}' > settings.json" })).toBe(true);
		});

		it("bash echo 追加写入 settings.json", () => {
			expect(isBlocked("bash", { command: "echo 'foo' >> settings.json" })).toBe(true);
		});

		it("bash tee 写入 settings.json", () => {
			expect(isBlocked("bash", { command: "echo '{}' | tee settings.json" })).toBe(true);
		});

		it("bash sed -i 修改 settings.json", () => {
			expect(isBlocked("bash", { command: "sed -i 's/foo/bar/' settings.json" })).toBe(true);
		});

		it("bash cp 覆盖 settings.json", () => {
			expect(isBlocked("bash", { command: "cp backup.json settings.json" })).toBe(true);
		});

		it("bash mv 覆盖 settings.json", () => {
			expect(isBlocked("bash", { command: "mv temp.json settings.json" })).toBe(true);
		});

		it("bash cat 重定向输出到 settings.json", () => {
			expect(isBlocked("bash", { command: "cat backup.json > settings.json" })).toBe(true);
		});
	});

	describe("不应该 block 的操作", () => {
		// --- read 无规则 ---
		it("read settings.json（无对应 block 规则）", () => {
			const readRules = settingsBlockRules.filter((r) => r.tool === "read");
			expect(readRules).toHaveLength(0);
		});

		// --- edit/write 其他文件 ---
		it("edit 其他 .json 文件", () => {
			expect(isBlocked("edit", { path: "/home/lain/.pi/agent/git/github.com/catlain/pi-shepherd/rules.json", edits: [] })).toBe(false);
		});

		it("edit .ts 文件", () => {
			expect(isBlocked("edit", { path: "src/index.ts", edits: [] })).toBe(false);
		});

		it("edit settings.ts（不是 .json）", () => {
			expect(isBlocked("edit", { path: "settings.ts", edits: [] })).toBe(false);
		});

		it("write 其他文件", () => {
			expect(isBlocked("write", { path: "output.txt", content: "hello" })).toBe(false);
		});

		// --- bash 读操作（不应拦截） ---
		it("bash cat 读取 settings.json（只读）", () => {
			expect(isBlocked("bash", { command: "cat /home/lain/.pi/agent/settings.json" })).toBe(false);
		});

		it("bash cat | head 读取 settings.json（只读）", () => {
			expect(isBlocked("bash", { command: "cat settings.json | head -3" })).toBe(false);
		});

		it("bash grep 搜索 settings.json（只读）", () => {
			expect(isBlocked("bash", { command: "grep 'mcp' settings.json" })).toBe(false);
		});

		it("bash diff 比较 settings.json（只读）", () => {
			expect(isBlocked("bash", { command: "diff settings.json settings.json.bak" })).toBe(false);
		});

		// --- bash 其他 ---
		it("bash 不含 settings.json 的命令", () => {
			expect(isBlocked("bash", { command: "npm test" })).toBe(false);
		});

		it("bash 不含 settings.json 的 Python 脚本", () => {
			expect(isBlocked("bash", { command: "python3 -c \"print('hello')\"" })).toBe(false);
		});

		// --- 边缘：my-settings.json ---
		it("edit my-settings.json（以 settings.json 结尾，仍被匹配）", () => {
			expect(isBlocked("edit", { path: "my-settings.json", edits: [] })).toBe(true);
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
