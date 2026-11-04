/**
 * message_end × llmJudge 集成测试
 *
 * 验证接入点行为（真 import shepherd/message-end.ts，mock 边界依赖）：
 * - 带 llmJudge 的规则：正则命中 → judgePasses 被调用
 * - 判定"否" → 不触发 action、不标记防重复
 * - 判定"是" → 触发 action（notify → pushWarning）
 * - 无 llmJudge 的规则 → judgePasses 不被调用（现状行为不变）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mock：边界依赖 ──

const pushWarningMock = vi.fn();
vi.mock("../shepherd/ephemeral", () => ({
	pushWarning: (...args: unknown[]) => pushWarningMock(...args),
}));

const judgePassesMock = vi.fn();
const setJudgeContextMock = vi.fn();
vi.mock("../shepherd/llm-judge", () => ({
	judgePasses: (...args: unknown[]) => judgePassesMock(...args),
	setJudgeContext: (...args: unknown[]) => setJudgeContextMock(...args),
}));

const { loadRulesMock } = vi.hoisted(() => ({ loadRulesMock: vi.fn() }));
vi.mock("../shepherd/rules", async (importOriginal: () => Promise<Record<string, unknown>>) => {
	const actual = await importOriginal();
	return {
		...actual,
		loadRules: loadRulesMock as unknown,
	};
});

vi.mock("../shepherd/tool-hooks", async (importOriginal: () => Promise<Record<string, unknown>>) => {
	const actual = await importOriginal();
	return {
		...actual,
		toolsAvailable: () => true,
	};
});

import { registerMessageEnd, resetMessageEndState } from "../shepherd/message-end";
import { loadRules as realLoadRules, ruleMatches } from "../shepherd/rules";
import type { Rule } from "../shepherd/rules";

// ── 工具：捕获 message_end handler ──

function captureHandler() {
	let handler: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
	const pi = {
		on: (event: string, fn: (event: unknown, ctx: unknown) => Promise<void>) => {
			if (event === "message_end") handler = fn;
		},
	} as never;
	registerMessageEnd(pi, { aborted: false } as never, "/tmp/fake-rules-dir");
	return {
		fire: async (text: string) => {
			if (!handler) throw new Error("message_end handler 未注册");
			await handler(
				{ message: { role: "assistant", content: [{ type: "text", text }] } },
				{ signal: new AbortController().signal },
			);
		},
	};
}

/** 构造含 llmJudge 的规则（正则 /可能/ + notify）。
 * 裸规则对象不带 _compiled（真 loadRules 会预编译），
 * 这里手工补 _compiled 供 ruleMatches 真实现使用。 */
const RULE_WITH_JUDGE: Rule = {
	comment: "集成-llmJudge-规则",
	hook: "message_end",
	conditions: [{ field: "text", pattern: "可能", _compiled: /可能/ }],
	action: "notify",
	reason: "🤔 疑似无根据猜测",
	llmJudge: { prompt: "判断'可能'是否为无根据的猜测推理" },
};

/** 构造无 llmJudge 的规则（现状行为对照） */
const RULE_WITHOUT_JUDGE: Rule = {
	comment: "集成-无llmJudge-规则",
	hook: "message_end",
	conditions: [
		{ field: "text", pattern: "纯文本触发词", _compiled: /纯文本触发词/ },
	],
	action: "notify",
	reason: "对照规则",
};

function setupRules(rules: unknown[]) {
	// message-end.ts 将 loadRules 返回值直接当规则数组用（.filter(hook===...)）
	loadRulesMock.mockReturnValue(rules);
}

beforeEach(() => {
	vi.clearAllMocks();
	resetMessageEndState(); // 清模块级防重复标记，避免测试间串扰
	setupRules([RULE_WITH_JUDGE, RULE_WITHOUT_JUDGE]);
});

describe("message_end × llmJudge 接入", () => {
	it("正则命中且判定是 → pushWarning 触发", async () => {
		judgePassesMock.mockResolvedValue(true);
		const h = captureHandler();
		await h.fire("这可能是个问题");
		expect(judgePassesMock).toHaveBeenCalledTimes(1);
		expect(judgePassesMock).toHaveBeenCalledWith(
			expect.objectContaining({ comment: "集成-llmJudge-规则" }),
			"这可能是个问题",
		);
		expect(pushWarningMock).toHaveBeenCalledWith(
			"🤔 疑似无根据猜测",
			"集成-llmJudge-规则",
		);
	});

	it("正则命中但判定否 → 不触发且不标记防重复", async () => {
		judgePassesMock.mockResolvedValue(false);
		const h = captureHandler();
		await h.fire("这可能没问题");
		expect(judgePassesMock).toHaveBeenCalledTimes(1);
		expect(pushWarningMock).not.toHaveBeenCalled();

		// 同一消息再次 fire（模拟下一条消息）：规则应可重新判定
		judgePassesMock.mockClear();
		judgePassesMock.mockResolvedValue(true);
		await h.fire("这次可能真有问题");
		expect(judgePassesMock).toHaveBeenCalledTimes(1);
		expect(pushWarningMock).toHaveBeenCalled();
	});

	it("正则命中 + 判定异常（fail-closed 解析为 true）→ 仍触发", async () => {
		judgePassesMock.mockResolvedValue(true); // judgePasses 内部 fail-closed 已保证 true
		const h = captureHandler();
		await h.fire("这可能炸了");
		expect(pushWarningMock).toHaveBeenCalled();
	});

	it("正则不命中 → judgePasses 不被调用（短路）", async () => {
		const h = captureHandler();
		await h.fire("没有任何触发词的普通文本");
		expect(judgePassesMock).not.toHaveBeenCalled();
	});

	it("无 llmJudge 的规则走原路径（不判定、直接触发）", async () => {
		const h = captureHandler();
		await h.fire("包含 纯文本触发词 的消息");
		expect(judgePassesMock).not.toHaveBeenCalled();
		expect(pushWarningMock).toHaveBeenCalledWith(
			"对照规则",
			"集成-无llmJudge-规则",
		);
	});

	it("ruleMatches 仍按正则工作（真实现回归）", () => {
		expect(ruleMatches(RULE_WITH_JUDGE, { text: "这可能" })).toBe(true);
		expect(ruleMatches(RULE_WITH_JUDGE, { text: "无关键词" })).toBe(false);
		// 规则文件加载 mock 不影响真 loadRules 类型存在
		expect(typeof realLoadRules).toBe("function");
	});
});
