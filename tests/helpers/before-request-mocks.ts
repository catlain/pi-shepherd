/**
 * before-request 测试共享 mock 与工具
 *
 * ⚠ vi.mock 调用必须留在测试文件（importOriginal 需测试文件上下文），
 * 这里只提供 vi.fn 定义与工具函数。
 */

import { vi } from "vitest";

export const mockedLoadRules = vi.fn((): any[] => []);
export const mockedJudgePasses = vi.fn(
	async (_rule: unknown, _text: string = ""): Promise<boolean> => true,
);
export const mockedPushWarning = vi.fn();
export const mockedSendMessage = vi.fn(async (_msg: unknown, _opts?: unknown) => {});

export function makePi() {
	return {
		on: vi.fn(),
		sendMessage: mockedSendMessage,
	} as any;
}

export const stateStub = { tracker: { getReadPaths: () => [] } } as any;

/** 触发已注册的 before_provider_request handler */
export function fireHandler(pi: any, messages: unknown[]) {
	const handler = pi.on.mock.calls.find(
		(c: any[]) => c[0] === "before_provider_request",
	)?.[1];
	if (!handler) throw new Error("handler 未注册");
	return handler({ payload: { messages } }, undefined);
}

export const userMsg = {
	role: "user",
	content: [{ type: "text", text: "帮我跑一下多因子回测" }],
};

/** 构造已编译规则（走真 compileRules，与线上形态一致）。须在测试用例内调用。 */
export async function compileRule(raw: Record<string, unknown>): Promise<any> {
	const { compileRules } = await vi.importActual<
		typeof import("../../shepherd/rules.js")
	>("../../shepherd/rules.js");
	return compileRules([raw as any])[0];
}
