/**
 * before-provider-request hook 集成测试 — 注册/预筛/动作/双源
 * （llmJudge 判定与缓存见 before-request-judge.test.ts）
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

import { registerBeforeRequestRules } from "../shepherd/before-request";

beforeEach(() => {
	vi.clearAllMocks();
	mockedLoadRules.mockReturnValue([]);
});

describe("注册与预筛", () => {
	it("注册了 handler", () => {
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		expect(
			pi.on.mock.calls.some((c: any[]) => c[0] === "before_provider_request"),
		).toBe(true);
	});

	it("无规则 → 零成本返回", async () => {
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("正则预筛不命中 → 零动作、不调 LLM", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "op",
				hook: "before_provider_request",
				pattern: "上实盘|部署",
				judgeSource: "lastUser",
				action: "steer",
				reason: "R1",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).not.toHaveBeenCalled();
		expect(mockedJudgePasses).not.toHaveBeenCalled();
	});
});

describe("动作与双源", () => {
	it("steer：pushWarning + sendMessage 带 reason content（入历史）且 triggerTurn:false", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "op",
				hook: "before_provider_request",
				pattern: "回测",
				judgeSource: "lastUser",
				action: "steer",
				reason: "⚠ 此类操作有技能，先读再操作",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).toHaveBeenCalledWith(
			"⚠ 此类操作有技能，先读再操作",
			"op",
		);
		expect(mockedSendMessage).toHaveBeenCalledTimes(1);
		const [msg, opts] = mockedSendMessage.mock.calls[0] as any[];
		expect(msg.content).toContain("先读再操作");
		expect(msg.display).toBe(false);
		expect(opts).toEqual({ triggerTurn: false });
	});

	it("notify：仅 pushWarning，不 sendMessage", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "n1",
				hook: "before_provider_request",
				pattern: "回测",
				action: "notify",
				reason: "R-n",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [userMsg]);
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
		expect(mockedSendMessage).not.toHaveBeenCalled();
	});

	it("judgeSource=lastAssistant：判 assistant 叙述而非用户消息", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "a1",
				hook: "before_provider_request",
				pattern: "探针|直连",
				judgeSource: "lastAssistant",
				action: "notify",
				reason: "R-a",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [
			{ role: "user", content: [{ type: "text", text: "用户消息不含关键词" }] },
			{
				role: "assistant",
				content: [{ type: "text", text: "反查落库链——写探针直连 DuckDB" }],
			},
			{
				role: "user",
				content: [{ type: "toolResult", toolCallId: "c", output: "ok" }],
			},
		]);
		expect(mockedPushWarning).toHaveBeenCalledTimes(1);
	});

	it("尾部 toolResult-only 且无更早用户文本 → 跳过", async () => {
		mockedLoadRules.mockReturnValue([
			await compileRule({
				comment: "t1",
				hook: "before_provider_request",
				pattern: "回测",
				judgeSource: "lastUser",
				action: "notify",
				reason: "R-t",
			}),
		]);
		const pi = makePi();
		registerBeforeRequestRules(pi, stateStub);
		await fireHandler(pi, [
			{
				role: "user",
				content: [{ type: "toolResult", toolCallId: "c", output: "x" }],
			},
		]);
		expect(mockedPushWarning).not.toHaveBeenCalled();
	});

	it("enabled=false 在 compileRules 层即剔除（before-request 拿不到该规则）", async () => {
		const compiled = await compileRule({
			comment: "e1",
			hook: "before_provider_request",
			pattern: "回测",
			action: "notify",
			reason: "R-e",
			enabled: false,
		});
		expect(compiled).toBeUndefined();
	});
});
