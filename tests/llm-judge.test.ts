/**
 * llm-judge 消费层单元测试（createJudge 骨架化重构后）：invert 包装 +
 * fail-closed + judge 实例参数透传。骨架行为由 shared-utils 侧测试守护。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── mock：shared-utils/judge（createJudge → 假实例）──

const { judgeInstanceMock, createJudgeMock } = vi.hoisted(() => {
	const judgeInstanceMock = {
		setContext: vi.fn(),
		resetContext: vi.fn(),
		judge: vi.fn(),
	};
	return { judgeInstanceMock, createJudgeMock: vi.fn(() => judgeInstanceMock) };
});
vi.mock("@pi-atelier/shared-utils/judge", () => ({
	createJudge: createJudgeMock,
}));

// mock restore-log（诊断落盘通道）
const { logDiagnosticMock } = vi.hoisted(() => ({ logDiagnosticMock: vi.fn() }));
vi.mock("../shepherd/restore-log", () => ({
	logDiagnostic: logDiagnosticMock,
	logRestore: vi.fn(),
}));

import {
	judgePasses,
	parseYesNo,
	resetJudgeContext,
	setJudgeContext,
} from "../shepherd/llm-judge";
import { compileRules } from "../shepherd/rules";

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

beforeEach(() => {
	vi.clearAllMocks();
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
	it("英文 Yes/No 兼容（发现8 修复）", () => {
		expect(parseYesNo("Yes")).toBe("是");
		expect(parseYesNo("NO")).toBe("否");
		expect(parseYesNo("**yes**")).toBe("是");
	});
});

// ── ctx 透传 ──

describe("ctx 注入透传到实例", () => {
	it("setJudgeContext 调实例 setContext", () => {
		const ctx = { model: {} } as never;
		setJudgeContext(ctx);
		expect(judgeInstanceMock.setContext).toHaveBeenCalledWith(ctx);
	});
	it("resetJudgeContext 调实例 resetContext", () => {
		resetJudgeContext();
		expect(judgeInstanceMock.resetContext).toHaveBeenCalled();
	});
});

// ── judgePasses ──

describe("judgePasses 判定与 fail-closed", () => {
	it("答 是 → 触发（true）", async () => {
		judgeInstanceMock.judge.mockResolvedValue("是");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "这段文本")).toBe(true);
	});
	it("答 否 → 不触发（false）", async () => {
		judgeInstanceMock.judge.mockResolvedValue("否");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "这段文本")).toBe(false);
	});
	it("invert=true：答 否 → 触发", async () => {
		judgeInstanceMock.judge.mockResolvedValue("否");
		const rule = makeRule({
			llmJudge: { prompt: "判断", invert: true },
		});
		expect(await judgePasses(rule, "这段文本")).toBe(true);
	});
	it("invert=true：答 是 → 不触发", async () => {
		judgeInstanceMock.judge.mockResolvedValue("是");
		const rule = makeRule({
			llmJudge: { prompt: "判断", invert: true },
		});
		expect(await judgePasses(rule, "这段文本")).toBe(false);
	});
	it("judge 返回 null（无 ctx/超时/解析失败）→ fail-closed（true）", async () => {
		judgeInstanceMock.judge.mockResolvedValue(null);
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		expect(await judgePasses(rule, "文本")).toBe(true);
	});
	it("无 llmJudge 配置 → 直接 true（不调实例）", async () => {
		const rule = makeRule({});
		expect(await judgePasses(rule, "文本")).toBe(true);
		expect(judgeInstanceMock.judge).not.toHaveBeenCalled();
	});
	it("参数透传：question=cfg.prompt / text / contextLabel=comment / model=cfg.model", async () => {
		judgeInstanceMock.judge.mockResolvedValue("是");
		const rule = makeRule({
			llmJudge: { prompt: "是否为猜测？", model: "zai/glm-5.2" },
		});
		await judgePasses(rule, "这段可能是猜测", 5000);
		expect(judgeInstanceMock.judge).toHaveBeenCalledWith({
			question: "是否为猜测？",
			text: "这段可能是猜测",
			contextLabel: "测试规则",
			model: "zai/glm-5.2",
			timeoutMs: 5000,
		});
	});
	it("timeoutMs 缺省不透传 undefined 之外的字段形态（默认由骨架 15000 承担）", async () => {
		judgeInstanceMock.judge.mockResolvedValue("是");
		const rule = makeRule({ llmJudge: { prompt: "判断" } });
		await judgePasses(rule, "文本");
		const arg = judgeInstanceMock.judge.mock.calls[0][0] as Record<string, unknown>;
		expect(arg.timeoutMs).toBe(15000);
	});
});

// ── 审计修复：加载时校验（compileRules 剥离无效 llmJudge）────────────

describe("compileRules llmJudge 加载校验（发现1/发现2 修复）", () => {
	it("prompt 为空时剥离 llmJudge 并落盘诊断，规则保留", () => {
		logDiagnosticMock.mockClear();
		const rule = makeRule({
			hook: "message_end",
			llmJudge: { prompt: "" },
		});
		const out = compileRules([rule]);
		expect(out[0].llmJudge).toBeUndefined();
		expect(out).toHaveLength(1); // 规则本身保留
		expect(logDiagnosticMock).toHaveBeenCalledWith(
			expect.stringContaining("llmJudge 配置无效"),
		);
	});
	it("hook 非 message_end 时剥离 llmJudge", () => {
		logDiagnosticMock.mockClear();
		const rule = makeRule({
			hook: "tool_call",
			llmJudge: { prompt: "判断" },
		});
		const out = compileRules([rule]);
		expect(out[0].llmJudge).toBeUndefined();
	});
	it("合法 llmJudge 不受影响", () => {
		const rule = makeRule({
			hook: "message_end",
			llmJudge: { prompt: "判断" },
		});
		const out = compileRules([rule]);
		expect(out[0].llmJudge).toEqual({ prompt: "判断" });
	});
});
