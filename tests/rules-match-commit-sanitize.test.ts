/** 2026-11-20 probe commit 夹带事故回归：
 * getMatchTargets 原在 tool_call 阶段对 git commit 整个丢弃 command，
 * 导致 commit-no-pathspec 等 5 条 git-guard 规则从未生效。
 * 修复后：message 脱敏为 <msg>，命令结构保留匹配。 */

import { describe, expect, it } from "vitest";
import { getMatchTargets, ruleMatches } from "../shepherd/rules-match";
import type { ToolEvent } from "../shepherd/tool-event-types";

const NO_PATHSPEC_RE = "^(?!.*\\s--(\\s|$)).*\\bgit\\s+commit\\b.*";

function bashEvent(command: string): ToolEvent {
	return { input: { command } } as ToolEvent;
}

function sanitized(command: string): string {
	return getMatchTargets("bash", bashEvent(command), "tool_call").command ?? "";
}

describe("getMatchTargets git commit 脱敏", () => {
	it("probe 事故命令（--allow-empty 无 pathspec）脱敏后保留结构", () => {
		expect(sanitized('git commit --allow-empty -m "probe: unmerged" -q')).toBe(
			"git commit --allow-empty -m <msg> -q",
		);
	});

	it("复合命令只脱敏 commit 段的 message", () => {
		const cmd = 'echo "--- 态2 ---"; git checkout -b t -q && git commit --allow-empty -m "probe: x" -q && echo done';
		expect(sanitized(cmd)).toBe('echo "--- 态2 ---"; git checkout -b t -q && git commit --allow-empty -m <msg> -q && echo done');
	});

	it("message 含危险词（sed -i / rm -rf）不残留在脱敏结果", () => {
		const out = sanitized('git commit -m "fix: use sed -i and rm -rf cleanup"');
		expect(out).not.toContain("sed -i");
		expect(out).not.toContain("rm -rf");
	});

	it("message 含 ' -- ' 字样不误放行无 pathspec commit", () => {
		// message 里的 -- 被脱敏掉，脱敏后命令无 -- pathspec → 规则仍应匹配（block）
		const out = sanitized('git commit -m "revert -- old behavior"');
		expect(out).toBe("git commit -m <msg>");
	});

	it("--message=\"x\" 等号形态也脱敏", () => {
		expect(sanitized('git commit --message="fix stuff"')).toBe("git commit --message=<msg>");
	});

	it("双引号内空格/逗号的 message 整体脱敏", () => {
		expect(sanitized('git commit -m "fix: a, b & c"')).toBe("git commit -m <msg>");
	});
});

describe("commit-no-pathspec 规则端到端（ruleMatches）", () => {
	const rule = {
		action: "block",
		comment: "[git-guard] block:commit-no-pathspec pathspec 物理强制",
		conditions: [{ field: "command", pattern: NO_PATHSPEC_RE, _compiled: new RegExp(NO_PATHSPEC_RE) }],
		tool: "bash",
	} as any;

	it("probe 事故命令触发 block（修复前永不触发）", () => {
		const targets = getMatchTargets(
			"bash",
			bashEvent('git commit --allow-empty -m "probe: unmerged" -q'),
			"tool_call",
		);
		expect(ruleMatches(rule, targets, undefined, "bash")).toBe(true);
	});

	it("带真 pathspec 的 commit 不误拦", () => {
		const targets = getMatchTargets(
			"bash",
			bashEvent('git commit -F /tmp/msg.txt -- scripts/a.py'),
			"tool_call",
		);
		expect(ruleMatches(rule, targets, undefined, "bash")).toBe(false);
	});

	it("message 里 -- 字样 + 真 pathspec：脱敏后仍放行", () => {
		const targets = getMatchTargets(
			"bash",
			bashEvent('git commit -m "fix -- typo" -- scripts/a.py'),
			"tool_call",
		);
		expect(ruleMatches(rule, targets, undefined, "bash")).toBe(false);
	});
});
