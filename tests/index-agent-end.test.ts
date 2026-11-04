/**
 * index.ts 测试 — agent_end（基础场景）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Rule } from "@pi-atelier/shepherd";
import {
	fireAgentEnd,
	makeEvent,
	makeMockPi,
	makeRules,
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

describe("agent_end — 基础场景", () => {
	let shepherdExtension: typeof import("../index").default;
	let pi: ReturnType<typeof makeMockPi>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		shepherdExtension(pi as unknown as ExtensionAPI);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function fire(event: unknown) {
		return fireAgentEnd(pi._handlers, event);
	}

	it("子代理时跳过", async () => {
		mocks.isSubagent.mockReturnValue(true);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mocks.loadRules).not.toHaveBeenCalled();
	});

	it("已中断则跳过", async () => {
		const ctrl = new AbortController();
		ctrl.abort();
		const agentStartHs = pi._handlers.get("agent_start")!;
		for (const h of agentStartHs) await h({}, { signal: ctrl.signal });

		mocks.isSubagent.mockReturnValue(false);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mocks.loadRules).not.toHaveBeenCalled();
	});

	it("无 agent_end 规则时跳过", async () => {
		mocks.loadRules.mockReturnValue([]);
		await fire({ messages: [{ role: "assistant" }] });
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("stopReason 不匹配时跳过", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ stopReason: ["end_turn"] } as unknown as Partial<Rule>]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("stopReason 匹配时触发", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ stopReason: ["stop"] }]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalledWith("test reason", "test-rule");
	});

	it("默认 stopReason 为 ['stop']", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{}]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalled();
	});

	it("重复 comment 不触发两次", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ comment: "same-rule" }]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalledTimes(1);

		mocks.pushWarning.mockClear();
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("不同 comment 各自触发", async () => {
		mocks.loadRules.mockReturnValue(
			makeRules([
				{ comment: "r1", reason: "first" },
				{ comment: "r2", reason: "second" },
			]),
		);
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalledWith("first", "r1");
		expect(mocks.pushWarning).toHaveBeenCalledWith("second", "r2");
		expect(mocks.pushWarning).toHaveBeenCalledTimes(2);
	});

	it("无 stopReason 的 assistant 视为空串，若规则允许空串则匹配", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ stopReason: [""] } as unknown as Partial<Rule>]));
		await fire({
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "ok" },
			],
		});
		expect(mocks.pushWarning).toHaveBeenCalled();
	});
});
