/**
 * before-provider-request hook 集成测试 — llmJudge 判定/缓存/fail-closed/合并注入
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	compileRule,
	fireHandler,
	makePi,
	mockedJudgePasses,
	mockedLoadRules,
	mockedPushWarning,
	mockedSendMessage,
	stateStub,
	userMsg,
} from "./helpers/before-request-mocks";

vi.mock("../shepherd/rules.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../shepherd/rules.js")>();
	return {
		...actual,
		loadRules: mockedLoadRules,
		isSubagent: () => false,
	};
});

vi.mock("../shepherd/llm-judge.js", () => ({
	judgePasses: mockedJudgePasses,
	setJudgeContext: vi.fn(),
}));

vi.mock("../shepherd/ephemeral.js", () => ({
	pushWarning: mockedPushWarning,
}));

vi.mock("../shepherd/tool-hooks.js", () => ({
	toolsAvailable: () => true,
}));

import { clearJudgeCache, registerBeforeRequestRules } from "../shepherd/before-request";

beforeEach(() => {
	vi.clearAllMocks();
	mockedJudgePasses.mockReset();
	mockedJudgePasses.mockResolvedValue(true);
	mockedLoadRules.mockReturnValue([]);
	clearJudgeCache();
});

describe("llmJudge 判定", () => {
	it("llmJudge=true → 触发；判定输入为 judgeText", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "j1",
				hook: "before_provider_request",
				pattern: "回测",
				judgeSource: "lastUser",
				action: "notify",
				reason: "R-j",
				llmJudge: { prompt: "判用户是否在要求操作类任务" },
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedJudgePasses).toHaveBeenCalledTimes(1);
		expect(mockedJudgePasses.mock.calls[0][1]).toBe("帮我跑一下多因子回测");
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
	});

	it("llmJudge=false → 不触发", async () => {
		mockedJudgePasses.mockResolvedValue(false);
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "j2",
				hook: "before_provider_request",
				pattern: "回测",
				action: "notify",
				reason: "R-j2",
				llmJudge: { prompt: "p" },
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	// fail-closed 说明：judgePasses 真实现永不抛（网络/超时/解析失败内部降级 return true，INV-03，
	// 由 tests/llm-judge.test.ts 三场景覆盖）——before-request 层无异常分支，无需在此重复测试。
});

describe("判定缓存与合并注入", () => {
	it("同规则同文本两次触发只判一次 LLM；不同规则（不同 key）各自判", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "c1",
				hook: "before_provider_request",
				pattern: "回测",
				action: "notify",
				reason: "R-c1",
				llmJudge: { prompt: "p1" },
			}),
			await compileRule({
				comment: "c2",
				hook: "before_provider_request",
				pattern: "因子",
				action: "notify",
				reason: "R-c2",
				llmJudge: { prompt: "p2" },
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]); // 首轮：c1、c2 各判一次
		await fireHandler(pi, [userMsg]); // 次轮：同文本缓存命中，不再判
		expect(mockedJudgePasses).toHaveBeenCalledTimes(2);
	});

	it("多条 steer 合并为一条 sendMessage（防续跑 turn 撕裂）", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "s1",
				hook: "before_provider_request",
				pattern: "回测",
				action: "steer",
				reason: "R-s1",
			}),
			await compileRule({
				comment: "s2",
				hook: "before_provider_request",
				pattern: "因子",
				action: "steer",
				reason: "R-s2",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedSendMessage).toHaveBeenCalledTimes(1);
		expect((mockedSendMessage.mock.calls[0][0] as any).content).toContain("R-s1");
		expect((mockedSendMessage.mock.calls[0][0] as any).content).toContain("R-s2");
	});

	// ── 防重注入（2026-11-06 pi -p 续跑循环事故防线） ──

	it("同文本二次触发（同 judgeText+comment）→ 只注入一次（防续跑循环）", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "once",
				hook: "before_provider_request",
				pattern: "回测",
				action: "steer",
				reason: "R-once",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		await fireHandler(pi, [userMsg]); // 续跑轮：同 judgeText
		expect(mockedSendMessage).toHaveBeenCalledTimes(1);
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
	});

	it("无 llmJudge 的纯正则规则同样防重（同文本二次触发只触发一次）", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "plain",
				hook: "before_provider_request",
				pattern: "回测",
				action: "notify",
				reason: "R-plain",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
	});
});
