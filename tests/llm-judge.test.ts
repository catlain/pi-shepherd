/**
 * llm-judge 单元测试
 *
 * 验证：
 * - parseYesNo：是/否解析（容忍装饰、首行无答案返回 null）
 * - resolveJudgeModel：三层回退（rule.llmJudge.model → settings → undefined）
 * - judgePasses：判定逻辑 + fail-closed 语义（异常/解析失败/无 ctx 一律 true）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── mock：shared-utils barrel（getEffectiveConfig）──

const { getEffectiveConfigMock } = vi.hoisted(() => ({ getEffectiveConfigMock: vi.fn() }));
vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...args: unknown[]) => getEffectiveConfigMock(...args),
}));

// ── mock：shared-utils/llm（createLLMCaller）──

const { createLLMCallerMock, callerMock } = vi.hoisted(() => {
	const callerMock = vi.fn();
	return { callerMock, createLLMCallerMock: vi.fn(() => callerMock) };
});
vi.mock("@pi-atelier/shared-utils/llm", () => ({
	createLLMCaller: createLLMCallerMock,
}));

// mock console.warn（fail-closed 诊断输出）

const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

import {
	judgePasses,
	parseYesNo,
	resetJudgeContext,
	resolveJudgeModel,
	setJudgeContext,
} from "../shepherd/llm-judge";

// ── 工具 ──

function makeRule(overrides: Record<string, unknown> = {}) {
	return {
		comment: "测试规则",
		hook: "message_end",
		conditions: [{ field: "text", pattern: "可能" }],
		action: "notify",
		reason: "test",
		...overrides,
	} as never;
}

function fakeCtx() {
	return {
		model: { provider: "p", id: "session-model" },
		modelRegistry: {
			find: vi.fn(),
			getApiKeyAndHeaders: vi.fn(),
		},
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	warnSpy.mockClear();
	resetJudgeContext();
});

afterEach(() => {
	resetJudgeContext();
});

// ── parseYesNo ──

describe("parseYesNo", () => {
	it("纯 是 → 是", () => {
		expect(parseYesNo("是")).toBe("是");
	});
	it("纯 否 → 否", () => {
		expect(parseYesNo("否")).toBe("否");
	});
	it("带装饰 **是** → 是", () => {
		expect(parseYesNo("**是**")).toBe("是");
	});
	it("答案：否。→ 否", () => {
		expect(parseYesNo("答案：否。")).toBe("否");
	});
	it("跳过空行取首个非空行", () => {
		expect(parseYesNo("\n\n  \n是")).toBe("是");
	});
	it("首个非空行无 是/否 → null", () => {
		expect(parseYesNo("无法判断\n是")).toBe(null);
	});
	it("空输出 → null", () => {
		expect(parseYesNo("")).toBe(null);
		expect(parseYesNo("  \n  ")).toBe(null);
	});
});

// ── resolveJudgeModel ──

describe("resolveJudgeModel 三层回退", () => {
	it("规则级 model 优先", () => {
		const rule = makeRule({
			llmJudge: { prompt: "p", model: "google/gemini-2.5-flash" },
		});
		expect(resolveJudgeModel(rule)).toBe("google/gemini-2.5-flash");
	});
	it("无规则级 → settings shepherd.judgeModel", () => {
		getEffectiveConfigMock.mockReturnValue({
			config: { judgeModel: "zai/glm-5.2" },
		});
		const rule = makeRule({ llmJudge: { prompt: "p" } });
		expect(resolveJudgeModel(rule)).toBe("zai/glm-5.2");
	});
	it("两级都无 → undefined（交 createLLMCaller 回退 ctx.model）", () => {
		getEffectiveConfigMock.mockReturnValue({ config: { judgeModel: "" } });
		const rule = makeRule({ llmJudge: { prompt: "p" } });
		expect(resolveJudgeModel(rule)).toBe(undefined);
	});
});

// ── judgePasses ──

describe("judgePasses 判定与 fail-closed", () => {
	it("答 是 → 触发（true）", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("是");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "这段文本")).toBe(true);
	});
	it("答 否 → 不触发（false）", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("否");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "这段文本")).toBe(false);
	});
	it("invert=true：答 否 → 触发", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("否");
		const rule = makeRule({
			llmJudge: { prompt: "判断", invert: true },
		});
		expect(await judgePasses(rule, "这段文本")).toBe(true);
	});
	it("invert=true：答 是 → 不触发", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("是");
		const rule = makeRule({
			llmJudge: { prompt: "判断", invert: true },
		});
		expect(await judgePasses(rule, "这段文本")).toBe(false);
	});
	it("caller 异常 → fail-closed（true）+ console.warn 诊断", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockRejectedValue(new Error("API key 不可用"));
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "文本")).toBe(true);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("API key 不可用"),
		);
	});
	it("输出解析失败 → fail-closed（true）", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("无法判断");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "文本")).toBe(true);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("无法解析为 是/否"),
		);
	});
	it("未注入 ctx → fail-closed（true）", async () => {
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "文本")).toBe(true);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("ExtensionContext"),
		);
	});
	it("createLLMCaller 收到 resolveJudgeModel 的结果与 label", async () => {
		setJudgeContext(fakeCtx());
		getEffectiveConfigMock.mockReturnValue({
			config: { judgeModel: "zai/glm-5.2" },
		});
		callerMock.mockResolvedValue("是");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		await judgePasses(rule, "文本");
		expect(createLLMCallerMock).toHaveBeenCalledWith(
			expect.anything(),
			"zai/glm-5.2",
			{ label: "[shepherd]" },
		);
	});
	it("prompt 与待判断文本拼进 user 消息", async () => {
		setJudgeContext(fakeCtx());
		callerMock.mockResolvedValue("是");
		const rule = makeRule({ llmJudge: { prompt: "是否为猜测？" } });
		await judgePasses(rule, "这段可能是猜测");
		const user = callerMock.mock.calls[0]?.[1] as string;
		expect(user).toContain("是否为猜测？");
		expect(user).toContain("这段可能是猜测");
	});
});
