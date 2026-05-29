/**
 * settings.json 规则的 getMatchTargets 字段映射测试
 *
 * 验证不同工具在 tool_call / tool_result 阶段的字段提取
 */

import { describe, expect, it } from "vitest";
import { getMatchTargets } from "../shepherd/rules";
import type { ToolEvent } from "../shepherd/event-types";

function makeEvent(toolName: string, input: Record<string, unknown>): ToolEvent {
	return { toolName, input } as ToolEvent;
}

describe("settings 规则 getMatchTargets 字段映射", () => {
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
