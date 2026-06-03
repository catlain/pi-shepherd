/**
 * Bridge godot_game_query block 规则测试
 *
 * 验证 find_nodes 错误参数 + get_tree 的拦截逻辑：
 * - find_nodes + 不存在的参数(search/name) → block
 * - find_nodes + 正确参数(pattern/type/limit) → 放行
 * - get_tree → block
 * - 其他 method (get_node_properties 等) → 放行
 */

import { describe, expect, it } from "vitest";
import type { ToolEvent } from "../shepherd/event-types";
import type { Rule } from "../shepherd/rules";
import { compileRules, getMatchTargets, ruleMatches } from "../shepherd/rules";

const TOOL = "godot_game_query";

// ====== 规则定义（与 rules.json 中 #37-#38 一致） ======

const bridgeBlockRules: Rule[] = [
	{
		hook: "tool_call",
		tool: TOOL,
		action: "block",
		comment: "[bridge] find_nodes 禁止用不存在的参数(search/name)",
		reason:
			"find_nodes 合法参数只有 pattern/type/group/limit。用 search/name 等不存在参数时 Bridge 静默忽略，匹配全部节点，返回 7k+ tokens。正确用法: find_nodes + pattern='*Button*' + type='Button' + limit=10",
		conditions: [
			{ field: "text", pattern: '"method"\\s*:\\s*"find_nodes"' },
			{ field: "text", pattern: '"(search|name)"\\s*:' },
		],
	} as Rule,
	{
		hook: "tool_call",
		tool: TOOL,
		action: "block",
		comment: "[bridge] get_tree 禁用——用 find_nodes 或 debug_summary 替代",
		reason:
			"get_tree 返回完整场景树（47k+ tokens），浪费大量上下文。改用: (1) find_nodes 查特定节点 (2) call_method 调 debug_summary() 一次获取全部状态",
		conditions: [{ field: "text", pattern: '"method"\\s*:\\s*"get_tree"' }],
	} as Rule,
];

compileRules(bridgeBlockRules);

// ====== 辅助函数 ======

function makeEvent(input: Record<string, unknown>): ToolEvent {
	return { toolName: TOOL, input } as ToolEvent;
}

function isBlocked(input: Record<string, unknown>): boolean {
	const event = makeEvent(input);
	const targets = getMatchTargets(TOOL, event, "tool_call");
	if (Object.keys(targets).length === 0) return false;
	return bridgeBlockRules.some((rule) => {
		if (rule.tool !== TOOL) return false;
		return ruleMatches(rule, TOOL, targets);
	});
}

// ====== 测试用例 ======

describe("Bridge godot_game_query block 规则", () => {
	// ── getMatchTargets: godot_game_query 的 text 提取 ──
	describe("getMatchTargets godot_game_query", () => {
		it("应该把 method/params 序列化为 text", () => {
			const event = makeEvent({
				method: "find_nodes",
				params: { search: "Button" },
			});
			const targets = getMatchTargets(TOOL, event, "tool_call");
			expect(targets.text).toContain('"method"');
			expect(targets.text).toContain('"find_nodes"');
			expect(targets.text).toContain('"search"');
		});

		it("get_tree 调用的 text 应包含 method:get_tree", () => {
			const event = makeEvent({ method: "get_tree" });
			const targets = getMatchTargets(TOOL, event, "tool_call");
			expect(targets.text).toContain('"method"');
			expect(targets.text).toContain('"get_tree"');
		});

		it("空参数的 text 应该是完整 JSON", () => {
			const event = makeEvent({});
			const targets = getMatchTargets(TOOL, event, "tool_call");
			expect(targets.text).toBe("{}");
		});
	});

	// ── find_nodes 错误参数 → block ──
	describe("find_nodes 错误参数应该 block", () => {
		it("find_nodes + search 参数 → block", () => {
			expect(
				isBlocked({ method: "find_nodes", params: { search: "Button" } }),
			).toBe(true);
		});

		it("find_nodes + name 参数 → block", () => {
			expect(
				isBlocked({ method: "find_nodes", params: { name: "LevelSelect" } }),
			).toBe(true);
		});

		it("find_nodes + search + type 混合 → block", () => {
			expect(
				isBlocked({
					method: "find_nodes",
					params: { search: "Button", type: "Button" },
				}),
			).toBe(true);
		});

		it("find_nodes + search 空字符串 → block", () => {
			expect(isBlocked({ method: "find_nodes", params: { search: "" } })).toBe(
				true,
			);
		});
	});

	// ── find_nodes 正确参数 → 放行 ──
	describe("find_nodes 正确参数应该放行", () => {
		it("find_nodes + pattern 参数 → 放行", () => {
			expect(
				isBlocked({ method: "find_nodes", params: { pattern: "*Button*" } }),
			).toBe(false);
		});

		it("find_nodes + type 参数 → 放行", () => {
			expect(
				isBlocked({ method: "find_nodes", params: { type: "Button" } }),
			).toBe(false);
		});

		it("find_nodes + pattern + type + limit → 放行", () => {
			expect(
				isBlocked({
					method: "find_nodes",
					params: { pattern: "*Control*", type: "Control", limit: 20 },
				}),
			).toBe(false);
		});

		it("find_nodes + group 参数 → 放行", () => {
			expect(
				isBlocked({ method: "find_nodes", params: { group: "enemies" } }),
			).toBe(false);
		});

		it("find_nodes 无参数 → 放行", () => {
			expect(isBlocked({ method: "find_nodes" })).toBe(false);
		});
	});

	// ── get_tree → block ──
	describe("get_tree 应该 block", () => {
		it("get_tree 无参数 → block", () => {
			expect(isBlocked({ method: "get_tree" })).toBe(true);
		});

		it("get_tree 带参数 → block", () => {
			expect(isBlocked({ method: "get_tree", params: { depth: 3 } })).toBe(
				true,
			);
		});
	});

	// ── 其他 method → 放行 ──
	describe("其他 method 应该放行", () => {
		it("get_node_properties → 放行", () => {
			expect(
				isBlocked({
					method: "get_node_properties",
					params: { path: "root/Main" },
				}),
			).toBe(false);
		});

		it("take_screenshot → 放行", () => {
			expect(isBlocked({ method: "take_screenshot" })).toBe(false);
		});

		it("ping → 放行", () => {
			expect(isBlocked({ method: "ping" })).toBe(false);
		});

		it("find_nodes + pattern 参数含 'search' 字符串 → 放行", () => {
			// pattern 值是 "search_box"，但参数名是 pattern（正确的），不应误判
			expect(
				isBlocked({
					method: "find_nodes",
					params: { pattern: "*search_box*" },
				}),
			).toBe(false);
		});
	});
});
