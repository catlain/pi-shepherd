/**
 * tool-hooks.ts 测试
 * 覆盖 registerToolCall 和 registerToolResult 的核心逻辑
 */

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolState } from "../shepherd/tool-hooks";
import {
	getAvailableTools,
	registerToolCall,
	registerToolResult,
	toolsAvailable,
} from "../shepherd/tool-hooks";
import type { StateTracker } from "../shepherd/state-tracker";

// Mock ephemeral 模块的 pushWarning
vi.mock("../shepherd/ephemeral.js", () => ({
	pushWarning: vi.fn(),
}));

// Mock line-count
vi.mock("../shepherd/line-count.js", () => ({
	checkLineCount: vi.fn(),
}));

const mockedGetMatchTargets = vi.fn();
const mockedRuleMatches = vi.fn();

// Mock rules 模块
vi.mock("../shepherd/rules.js", () => ({
	loadRules: vi.fn(() => []),
	getMatchTargets: (...args: any[]) => mockedGetMatchTargets(...args),
	isRtkAvailable: false,
	isSubagent: vi.fn(() => false),
	ruleMatches: (...args: any[]) => mockedRuleMatches(...args),
}));

import { pushWarning } from "../shepherd/ephemeral.js";
import { checkLineCount } from "../shepherd/line-count.js";
import { loadRules, isSubagent, getMatchTargets as realGetMatchTargets, ruleMatches as realRuleMatches } from "../shepherd/rules.js";

const mockedPushWarning = vi.mocked(pushWarning);
const mockedCheckLineCount = vi.mocked(checkLineCount);
const mockedLoadRules = vi.mocked(loadRules);
const mockedIsSubagent = vi.mocked(isSubagent);

function makeToolState(): ToolState {
	return {
		hasEdits: false,
		tracker: {
			update: vi.fn(),
			resetIf: vi.fn(),
			isTriggered: vi.fn(() => false),
			nextThreshold: vi.fn((n) => n),
			getStats: vi.fn(() => ({ count: 0, chars: 0, errors: 0 })),
			matches: vi.fn(() => false),
			markTriggered: vi.fn(),
		} as unknown as StateTracker,
		cachedTools: null,
	};
}

function makePi() {
	const handlers: Record<string, Function> = {};
	return {
		handlers,
		on: vi.fn((event: string, handler: Function) => {
			handlers[event] = handler;
		}),
		getActiveTools: vi.fn(() => ["edit", "write", "bash", "read", "grep"]),
	};
}

describe("tool-hooks", () => {
	let state: ToolState;
	let pi: ReturnType<typeof makePi>;

	beforeEach(() => {
		vi.clearAllMocks();
		state = makeToolState();
		pi = makePi();
	});

	// ================================================================
	// registerToolCall
	// ================================================================

	describe("registerToolCall", () => {
		it("应该注册 tool_call 事件", () => {
			registerToolCall(pi as any, state);
			expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
		});

		it("edit/write 应该标记 hasEdits", async () => {
			registerToolCall(pi as any, state);
			const handler = pi.handlers["tool_call"];

			await handler({ toolName: "edit", input: { path: "foo.ts" } });
			expect(state.hasEdits).toBe(true);

			state.hasEdits = false;
			await handler({ toolName: "write", input: { path: "bar.ts" } });
			expect(state.hasEdits).toBe(true);
		});

		it("非 edit/write 不标记 hasEdits", async () => {
			registerToolCall(pi as any, state);
			const handler = pi.handlers["tool_call"];

			await handler({ toolName: "bash", input: { command: "ls" } });
			expect(state.hasEdits).toBe(false);
		});

		it("block 规则应该返回 block 结果", async () => {
			mockedLoadRules.mockReturnValue([
				{
					hook: "tool_call",
					tool: "edit",
					action: "block",
					reason: "禁止编辑",
					subagent: true,
					requiresTools: [],
				},
			]);
			mockedGetMatchTargets.mockReturnValue({ path: "foo.ts", text: "" });
			mockedRuleMatches.mockReturnValue(true);

			registerToolCall(pi as any, state);
			const handler = pi.handlers["tool_call"];

			const result = await handler({ toolName: "edit", input: { path: "foo.ts" } });
			expect(result).toEqual({ block: true, reason: "⛔ shepherd: 禁止编辑" });
		});

		it("subagent=false 的规则在子代理中应跳过", async () => {
			mockedIsSubagent.mockReturnValue(true);
			mockedLoadRules.mockReturnValue([
				{
					hook: "tool_call",
					tool: "edit",
					action: "block",
					reason: "禁止编辑",
					subagent: false,
					requiresTools: [],
				},
			]);

			registerToolCall(pi as any, state);
			const handler = pi.handlers["tool_call"];

			const result = await handler({ toolName: "edit", input: { path: "foo.ts" } });
			expect(result).toBeUndefined();
		});
	});

	// ================================================================
	// registerToolResult
	// ================================================================

	describe("registerToolResult", () => {
		it("应该注册 tool_result 事件", () => {
			registerToolResult(pi as any, state);
			expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
		});

		it("edit 后应该调用 checkLineCount", async () => {
			registerToolResult(pi as any, state);
			const handler = pi.handlers["tool_result"];

			await handler({
				toolName: "edit",
				input: { path: join(process.cwd(), "foo.ts") },
				content: [{ type: "text", text: "ok" }],
			});
			expect(mockedCheckLineCount).toHaveBeenCalledWith(
				join(process.cwd(), "foo.ts"),
			);
		});

		it("memory_update 后应从结果文本提取路径并检查行数", async () => {
			registerToolResult(pi as any, state);
			const handler = pi.handlers["tool_result"];

			await handler({
				toolName: "memory_update",
				input: { fileName: "test.md" },
				content: [
					{ type: "text", text: "已写入 `memory/test--kw1,kw2.md`" },
				],
			});
			expect(mockedCheckLineCount).toHaveBeenCalledWith(
				"memory/test--kw1,kw2.md",
			);
		});

		it("应该更新 tracker 状态", async () => {
			registerToolResult(pi as any, state);
			const handler = pi.handlers["tool_result"];
			const text = "file1\nfile2";

			await handler({
				toolName: "bash",
				input: { command: "ls" },
				content: [{ type: "text", text }],
				isError: false,
			});
			expect(state.tracker.update).toHaveBeenCalledWith(
				"bash",
				text.length,
				false,
			);
		});

		it("steer 规则应该 pushWarning", async () => {
			mockedLoadRules.mockReturnValue([
				{
					hook: "tool_result",
					action: "steer",
					reason: "已编辑 {count} 次",
					comment: "edit-count",
					subagent: true,
					state: { tools: ["edit"], gte: 3 },
					requiresTools: [],
				},
			]);
			(state.tracker as any).matches = vi.fn(() => true);
			(state.tracker as any).getStats = vi.fn(() => ({
				count: 5,
				chars: 1200,
				errors: 0,
			}));

			registerToolResult(pi as any, state);
			const handler = pi.handlers["tool_result"];

			await handler({
				toolName: "bash",
				input: {},
				content: [{ type: "text", text: "ok" }],
			});

			expect(mockedPushWarning).toHaveBeenCalledWith(
				"已编辑 5 次",
				"edit-count",
			);
		});
	});

	// ================================================================
	// getAvailableTools / toolsAvailable
	// ================================================================

	describe("getAvailableTools & toolsAvailable", () => {
		it("第一次调用应从 pi 获取工具列表并缓存", () => {
			const result = getAvailableTools(pi as any, state);
			expect(pi.getActiveTools).toHaveBeenCalledTimes(1);
			expect(result.has("edit")).toBe(true);

			// 第二次不调 pi
			getAvailableTools(pi as any, state);
			expect(pi.getActiveTools).toHaveBeenCalledTimes(1);
		});

		it("rule 不需要工具时 toolsAvailable 返回 true", () => {
			expect(toolsAvailable({}, pi as any, state)).toBe(true);
			expect(toolsAvailable({ requiresTools: [] }, pi as any, state)).toBe(
				true,
			);
		});

		it("rule 需要的工具不可用时返回 false", () => {
			expect(
				toolsAvailable(
					{ requiresTools: ["edit", "nonexistent_tool"] },
					pi as any,
					state,
				),
			).toBe(false);
		});
	});
});
