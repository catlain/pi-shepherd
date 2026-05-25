/**
 * agent_end 触发逻辑测试
 *
 * 模拟 agent_end handler 的核心判断逻辑，覆盖所有场景：
 * - has_edits / git_uncommitted / always 三种 check
 * - 子代理排除 / 中断跳过 / stopReason 过滤 / 重复触发防循环
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { pushWarning, hasWarnings, drainHints } from "@pi-atelier/shepherd";

// ── 模拟 agent_end handler 的核心逻辑 ──

interface SimState {
	isSubagent: boolean;
	aborted: boolean;
	hasEdits: boolean;
	isDirty: boolean;
	wasDirty: boolean;
	agentEndFired: Set<string>;
}

interface SimRule {
	comment: string;
	hook: string;
	action: string;
	check?: string;
	stopReason?: string[];
}

/**
 * 模拟 agent_end handler 的判断逻辑
 * 返回触发结果列表
 */
function simulateAgentEnd(
	state: SimState,
	rules: SimRule[],
	stopReason: string,
): string[] {
	const triggered: string[] = [];

	// 前置检查
	if (state.isSubagent || state.aborted) return triggered;

	for (const rule of rules) {
		const allowedReasons = rule.stopReason ?? ["stop"];
		if (!allowedReasons.includes(stopReason)) continue;
		if (state.agentEndFired.has(rule.comment)) continue;

		let shouldNotify = false;
		if (rule.check === "git_uncommitted") {
			shouldNotify = state.isDirty && state.hasEdits;
			state.wasDirty = state.isDirty;
		} else if (rule.check === "has_edits") {
			shouldNotify = state.hasEdits;
		} else if (rule.check === "always" || !rule.check) {
			shouldNotify = true;
		}

		if (shouldNotify && rule.action === "notify") {
			state.agentEndFired.add(rule.comment);
			triggered.push(rule.comment);
		}
	}

	return triggered;
}

// ── 测试 ──

describe("agent_end 触发逻辑", () => {
	const RULE_HAS_EDITS: SimRule = {
		comment: "[收尾] 编辑后提醒 commit + 记忆更新 + 总结",
		hook: "agent_end",
		action: "notify",
		check: "has_edits",
		stopReason: ["stop"],
	};

	const RULE_GIT_UNCOMMITTED: SimRule = {
		comment: "[git] 本轮新增未提交改动",
		hook: "agent_end",
		action: "notify",
		check: "git_uncommitted",
		stopReason: ["stop"],
	};

	const RULE_ALWAYS: SimRule = {
		comment: "[always] 无条件提醒",
		hook: "agent_end",
		action: "notify",
		check: "always",
		stopReason: ["stop"],
	};

	let state: SimState;

	beforeEach(() => {
		state = {
			isSubagent: false,
			aborted: false,
			hasEdits: false,
			isDirty: false,
			wasDirty: false,
			agentEndFired: new Set(),
		};
	});

	// ════════════════════════════════════════════
	// 场景 A：正常编辑后结束（最常见场景）
	// ════════════════════════════════════════════
	describe("场景 A：正常编辑后结束", () => {
		it("有编辑 + git dirty → 触发 has_edits 提醒", () => {
			state.hasEdits = true;
			state.isDirty = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(result, ["[收尾] 编辑后提醒 commit + 记忆更新 + 总结"]);
		});

		it("有编辑 + git 干净 → 仍触发 has_edits 提醒（记忆/总结仍有意义）", () => {
			state.hasEdits = true;
			state.isDirty = false;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(result, ["[收尾] 编辑后提醒 commit + 记忆更新 + 总结"]);
		});

		it("无编辑 → 不触发", () => {
			state.hasEdits = false;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(result, []);
		});
	});

	// ════════════════════════════════════════════
	// 场景 B：只读（无编辑）
	// ════════════════════════════════════════════
	describe("场景 B：只读无编辑", () => {
		it("has_edits 规则不触发", () => {
			state.hasEdits = false;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(result, []);
		});

		it("always 规则仍触发（如果配置了）", () => {
			state.hasEdits = false;
			const result = simulateAgentEnd(state, [RULE_ALWAYS], "stop");
			assert.deepEqual(result, ["[always] 无条件提醒"]);
		});
	});

	// ════════════════════════════════════════════
	// 场景 C：ESC 中断
	// ════════════════════════════════════════════
	describe("场景 C：ESC 中断", () => {
		it("中断时所有规则都不触发", () => {
			state.aborted = true;
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS, RULE_ALWAYS], "stop");
			assert.deepEqual(result, []);
		});
	});

	// ════════════════════════════════════════════
	// 场景 D：子代理
	// ════════════════════════════════════════════
	describe("场景 D：子代理中", () => {
		it("子代理所有规则都不触发", () => {
			state.isSubagent = true;
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS, RULE_ALWAYS], "stop");
			assert.deepEqual(result, []);
		});
	});

	// ════════════════════════════════════════════
	// 场景 E：stopReason 不是 stop（LLM 还在调工具）
	// ════════════════════════════════════════════
	describe("场景 E：stopReason 过滤", () => {
		it("stopReason=tool_use → 不触发", () => {
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "tool_use");
			assert.deepEqual(result, []);
		});

		it("stopReason=length → 不触发", () => {
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "length");
			assert.deepEqual(result, []);
		});

		it("stopReason=stop → 触发", () => {
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(result.length, 1);
		});
	});

	// ════════════════════════════════════════════
	// 场景 F：重复触发防循环
	// ════════════════════════════════════════════
	describe("场景 F：防循环", () => {
		it("同一规则同一轮只触发一次", () => {
			state.hasEdits = true;
			const r1 = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(r1, ["[收尾] 编辑后提醒 commit + 记忆更新 + 总结"]);
			// 第二次调用，_agentEndFired 已有该规则
			const r2 = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.deepEqual(r2, []);
		});
	});

	// ════════════════════════════════════════════
	// 场景 G：git_uncommitted check（虽然当前无此规则，但代码保留）
	// ════════════════════════════════════════════
	describe("场景 G：git_uncommitted check 逻辑", () => {
		it("dirty + hasEdits → 触发", () => {
			state.isDirty = true;
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_GIT_UNCOMMITTED], "stop");
			assert.deepEqual(result, ["[git] 本轮新增未提交改动"]);
		});

		it("dirty 但无 edits → 不触发", () => {
			state.isDirty = true;
			state.hasEdits = false;
			const result = simulateAgentEnd(state, [RULE_GIT_UNCOMMITTED], "stop");
			assert.deepEqual(result, []);
		});

		it("干净仓库 + 有 edits → 不触发", () => {
			state.isDirty = false;
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_GIT_UNCOMMITTED], "stop");
			assert.deepEqual(result, []);
		});

		it("仓库一直 dirty + 本轮有 edits → 触发（修复 !_wasDirty 的 bug）", () => {
			state.isDirty = true;
			state.wasDirty = true;  // 仓库一直脏
			state.hasEdits = true;
			const result = simulateAgentEnd(state, [RULE_GIT_UNCOMMITTED], "stop");
			assert.deepEqual(result, ["[git] 本轮新增未提交改动"]);
		});
	});

	// ════════════════════════════════════════════
	// 场景 H：多条规则同时触发
	// ════════════════════════════════════════════
	describe("场景 H：多规则同时触发", () => {
		it("has_edits + git_uncommitted 同时满足 → 都触发", () => {
			state.hasEdits = true;
			state.isDirty = true;
			const result = simulateAgentEnd(
				state,
				[RULE_HAS_EDITS, RULE_GIT_UNCOMMITTED],
				"stop",
			);
			assert.equal(result.length, 2);
			assert.ok(result.includes("[收尾] 编辑后提醒 commit + 记忆更新 + 总结"));
			assert.ok(result.includes("[git] 本轮新增未提交改动"));
		});

		it("has_edits 触发但 git_uncommitted 不触发（git 干净）", () => {
			state.hasEdits = true;
			state.isDirty = false;
			const result = simulateAgentEnd(
				state,
				[RULE_HAS_EDITS, RULE_GIT_UNCOMMITTED],
				"stop",
			);
			assert.deepEqual(result, ["[收尾] 编辑后提醒 commit + 记忆更新 + 总结"]);
		});
	});

	// ════════════════════════════════════════════
	// 场景 I：agent_start 重置
	// ════════════════════════════════════════════
	describe("场景 I：agent_start 重置状态", () => {
		it("新一轮 agent_start 后 agentEndFired 清空，可再次触发", () => {
			state.hasEdits = true;
			// 第一轮触发
			const r1 = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.equal(r1.length, 1);
			// 模拟 agent_start：clear agentEndFired + reset hasEdits
			state.agentEndFired.clear();
			state.hasEdits = false;
			// 第二轮无编辑 → 不触发
			const r2 = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.equal(r2.length, 0);
			// 第三轮有编辑 → 触发
			state.hasEdits = true;
			const r3 = simulateAgentEnd(state, [RULE_HAS_EDITS], "stop");
			assert.equal(r3.length, 1);
		});
	});
});
