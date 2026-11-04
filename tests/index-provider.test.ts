/**
 * index.ts 测试 — before_provider_request
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	fireSystemEvent,
	getHandler,
	makeMockPi,
	mocks,
} from "./helpers/shared-mocks";

vi.mock("@pi-atelier/shared-utils", async () =>
	(await import("./helpers/shared-mocks")).sharedUtilsFactory(),
);
vi.mock("../shepherd", async (importOriginal) =>
	(await import("./helpers/shared-mocks")).barrelFactory(
		(await importOriginal()) as Record<string, unknown>,
	),
);
vi.mock("../shepherd/rules-tool", async () =>
	(await import("./helpers/shared-mocks")).rulesToolFactory(),
);
// 真实 agent-hooks/hint-injector 的依赖走子模块路径拦截
vi.mock("../shepherd/rules", async (importOriginal) =>
	(await import("./helpers/shared-mocks")).rulesFactory(
		(await importOriginal()) as Record<string, unknown>,
	),
);
vi.mock("../shepherd/ephemeral", async (importOriginal) =>
	(await import("./helpers/shared-mocks")).ephemeralFactory(
		(await importOriginal()) as Record<string, unknown>,
	),
);
vi.mock("../shepherd/ephemeral-shared", async (importOriginal) =>
	(await import("./helpers/shared-mocks")).ephemeralSharedFactory(
		(await importOriginal()) as Record<string, unknown>,
	),
);

// ── 测试 ──
describe("before_provider_request", () => {
	let shepherdExtension: typeof import("../index").default;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		shepherdExtension(pi as unknown as ExtensionAPI);
	});

	it("有 hints 时注入到 payload 并通知", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "remember to commit" });
		mocks.drainHints.mockReturnValue("");

		const payload = { messages: [{ role: "user", content: "hi" }] };
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			ctx,
		);

		expect(result).not.toBe(payload);
		expect(result.messages).toHaveLength(2);
		expect(result.messages[1].role).toBe("user");
		expect(result.messages[1].content[0].text).toContain("remember to commit");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.any(String), "warning");
	});

	it("无 hints 时不修改 payload", async () => {
		mocks.drainHints.mockReturnValue("");

		const payload = { messages: [{ role: "user", content: "hi" }] };
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			ctx,
		);

		expect(result.messages).toHaveLength(1);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("empty messages 时也能注入", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "test hint" });
		mocks.drainHints.mockReturnValue("");

		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] as unknown[] } },
			{ ui: { notify: vi.fn() } },
		);

		expect(result.messages).toHaveLength(1);
	});

	it("drainHints 返回内容时优先添加到开头", async () => {
		mocks.drainHints.mockReturnValue("shepherd steer hint");
		fireSystemEvent(pi, "ephemeral:hint", { text: "cross extension hint" });

		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [{ role: "user", content: "hi" }] } },
			ctx,
		);

		const injectedText = result.messages[1].content[0].text;
		expect(injectedText).toContain("shepherd steer hint");
		expect(injectedText).toContain("cross extension hint");
	});

	it("无 hints + 无 messages 字段返回 payload 原样", async () => {
		mocks.drainHints.mockReturnValue("");
		const payload = {} as Record<string, unknown>;
		const result = await getHandler(pi, "before_provider_request")(
			{ payload },
			{ ui: { notify: vi.fn() } },
		);
		expect(result.messages).toBeUndefined();
	});

	it("drainHints 空且 _localHints 空时不注入", async () => {
		mocks.drainHints.mockReturnValue("");
		const ctx = { ui: { notify: vi.fn() } };
		const result = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [{ role: "user", content: "hi" }] } },
			ctx,
		);

		expect(result.messages).toHaveLength(1);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("多次调用消耗 hints，第二次无注入", async () => {
		fireSystemEvent(pi, "ephemeral:hint", { text: "single use hint" });
		mocks.drainHints.mockReturnValue("");

		const ctx = { ui: { notify: vi.fn() } };
		const r1 = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] } },
			ctx,
		);
		expect(r1.messages).toHaveLength(1);
		expect(ctx.ui.notify).toHaveBeenCalledTimes(1);

		// 第二次调用 — hints 已消耗
		const r2 = await getHandler(pi, "before_provider_request")(
			{ payload: { messages: [] } },
			{ ui: { notify: vi.fn() } },
		);
		expect(r2.messages).toHaveLength(0);
	});
});
