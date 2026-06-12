/**
 * getMatchTargets 的 result 字段测试
 *
 * 验证 tool_result 阶段提取工具输出文本，tool_call 阶段 result 为空
 */

import { describe, expect, it } from "vitest";
import type { ToolEvent } from "../shepherd/tool-event-types";
import { getMatchTargets, ruleMatches } from "../shepherd/rules";
import type { Rule } from "../shepherd/types";

/** 构造 tool_call 事件（无 content） */
function makeCallEvent(
	toolName: string,
	input: Record<string, unknown>,
): ToolEvent {
	return { type: "tool_call", toolName, input } as ToolEvent;
}

/** 构造 tool_result 事件（带 content） */
function makeResultEvent(
	toolName: string,
	input: Record<string, unknown>,
	content: Array<{ type: string; text?: string }>,
): ToolEvent {
	return {
		type: "tool_result",
		toolName,
		input,
		content,
	} as ToolEvent;
}

describe("getMatchTargets result 字段", () => {
	it("tool_call 阶段 result 为空字符串", () => {
		const targets = getMatchTargets(
			"code_graph_module_overview",
			makeCallEvent("code_graph_module_overview", { path: "pi-intercom" }),
			"tool_call",
		);
		expect(targets.result).toBe("");
	});

	it("tool_result 阶段提取 content 中的文本", () => {
		const targets = getMatchTargets(
			"code_graph_module_overview",
			makeResultEvent(
				"code_graph_module_overview",
				{ path: "pi-intercom" },
				[{ type: "text", text: "0 active + 0 inactive exports across 0 files" }],
			),
			"tool_result",
		);
		expect(targets.result).toBe(
			"0 active + 0 inactive exports across 0 files",
		);
	});

	it("tool_result 阶段无 content 时 result 为空字符串", () => {
		const targets = getMatchTargets(
			"bash",
			makeResultEvent("bash", { command: "echo hello" }, []),
			"tool_result",
		);
		expect(targets.result).toBe("");
	});

	it("tool_result 阶段 content 只有 image 块时 result 为空字符串", () => {
		const targets = getMatchTargets(
			"vision_analyze",
			makeResultEvent(
				"vision_analyze",
				{ image_source: "test.png" },
				[{ type: "image", data: "base64..." }],
			),
			"tool_result",
		);
		expect(targets.result).toBe("");
	});

	it("tool_result 阶段多个 text 块拼接", () => {
		const targets = getMatchTargets(
			"bash",
			makeResultEvent(
				"bash",
				{ command: "ls" },
				[
					{ type: "text", text: "file1.ts\n" },
					{ type: "text", text: "file2.ts\n" },
				],
			),
			"tool_result",
		);
		expect(targets.result).toBe("file1.ts\nfile2.ts\n");
	});

	it("bash tool_result 同时有 command 和 result", () => {
		const targets = getMatchTargets(
			"bash",
			makeResultEvent(
				"bash",
				{ command: "echo hello" },
				[{ type: "text", text: "hello\n" }],
			),
			"tool_result",
		);
		expect(targets.command).toBe("echo hello");
		expect(targets.result).toBe("hello\n");
	});

	it("自定义工具 tool_result 提取正确", () => {
		const targets = getMatchTargets(
			"my_custom_tool",
			makeResultEvent(
				"my_custom_tool",
				{ query: "test" },
				[{ type: "text", text: '{"status":"ok"}' }],
			),
			"tool_result",
		);
		expect(targets.result).toBe('{"status":"ok"}');
	});

	it("git commit 短路返回也包含 result 字段", () => {
		const targets = getMatchTargets(
			"bash",
			makeResultEvent(
				"bash",
				{ command: "git commit -m 'fix'" },
				[{ type: "text", text: "[main abc1234] fix" }],
			),
			"tool_call",
		);
		// git commit 在 tool_call 阶段短路返回空对象，但 result 字段应存在
		expect(targets.result).toBe("");
	});

	it("text 块无 text 属性时视为空字符串", () => {
		const targets = getMatchTargets(
			"bash",
			makeResultEvent(
				"bash",
				{ command: "test" },
				[{ type: "text" }], // text 属性缺失
			),
			"tool_result",
		);
		expect(targets.result).toBe("");
	});
});

describe("ruleMatches 端到端 — field=result 规则匹配", () => {
	it("field=result 规则能匹配 tool_result 阶段的结果文本", () => {
		const rule: Rule = {
			comment: "test result match",
			hook: "tool_result",
			tool: "code_graph_module_overview",
			conditions: [{ field: "result", pattern: "0 active \\+ 0 inactive", _compiled: /0 active \+ 0 inactive/ }],
			action: "notify",
			reason: "test hint",
		};

		const targets = getMatchTargets(
			"code_graph_module_overview",
			makeResultEvent(
				"code_graph_module_overview",
				{ path: "pi-intercom" },
				[
					{
						type: "text",
						text: "Module 'pi-intercom': 0 active + 0 inactive exports across 0 files",
					},
				],
			),
			"tool_result",
		);

		expect(targets.result).toContain("0 active + 0 inactive");
		expect(ruleMatches(rule, targets)).toBe(true);
	});

	it("field=result 规则在 tool_call 阶段不匹配（result 为空）", () => {
		const rule: Rule = {
			comment: "test result not match on tool_call",
			hook: "tool_call",
			tool: "code_graph_module_overview",
			conditions: [{ field: "result", pattern: "0 active", _compiled: /0 active/ }],
			action: "notify",
			reason: "test hint",
		};

		const targets = getMatchTargets(
			"code_graph_module_overview",
			makeCallEvent("code_graph_module_overview", { path: "pi-intercom" }),
			"tool_call",
		);

		expect(targets.result).toBe("");
		expect(ruleMatches(rule, targets)).toBe(false);
	});

	it("field=result 与 field=text 可同时匹配不冲突", () => {
		const textRule: Rule = {
			comment: "match input text",
			hook: "tool_result",
			tool: "code_graph_module_overview",
			conditions: [{ field: "text", pattern: '"path":"pi-intercom"', _compiled: /"path":"pi-intercom"/ }],
			action: "notify",
			reason: "test",
		};
		const resultRule: Rule = {
			comment: "match result text",
			hook: "tool_result",
			tool: "code_graph_module_overview",
			conditions: [{ field: "result", pattern: "0 active", _compiled: /0 active/ }],
			action: "notify",
			reason: "test",
		};

		const targets = getMatchTargets(
			"code_graph_module_overview",
			makeResultEvent(
				"code_graph_module_overview",
				{ path: "pi-intercom" },
				[{ type: "text", text: "0 active + 0 inactive" }],
			),
			"tool_result",
		);

		expect(ruleMatches(textRule, targets)).toBe(true);
		expect(ruleMatches(resultRule, targets)).toBe(true);
	});
});
