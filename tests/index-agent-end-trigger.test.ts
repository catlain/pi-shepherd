/**
 * index.ts 测试 — agent_end triggerTurn / abort 信号
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	fireAgentEnd,
	makeEvent,
	makeMockPi,
	makeRules,
	mocks,
} from "./helpers/shared-mocks";

// 本文件特化：registerToolCall 注册 tool_call handler 模拟 hasEdits 置位
mocks.registerToolCall.mockImplementation(((pi: any, toolState: any) => {
	pi.on("tool_call", () => {
		toolState.hasEdits = true;
	});
}) as never);

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

// fireAgentEnd/makeEvent 等见 helpers/shared-mocks


describe("agent_end — triggerTurn / abort", () => {
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

	it("有 warnings 时 agent_before_settle 返回 continue: true", async () => {
		mocks.hasWarnings.mockReturnValue(true);
		mocks.loadRules.mockReturnValue(
			makeRules([{ check: "always", comment: "warn-rule" }]),
		);

		await fire(makeEvent("stop"));

		const hs = pi._handlers.get("agent_before_settle") ?? [];
		const results: unknown[] = [];
		for (const h of hs) results.push(await h({}, {}));
		expect(results).toContainEqual({ continue: true });
	});

	it("无 warnings 时 continue 不为 true", async () => {
		mocks.hasWarnings.mockReturnValue(false);
		// has_edits + 没有编辑 → 条件不匹配 → pushed=false → 无 warning
		mocks.loadRules.mockReturnValue(makeRules([{ check: "has_edits" }]));

		await fire(makeEvent("stop"));
		const hs = pi._handlers.get("agent_before_settle") ?? [];
		const results: unknown[] = [];
		for (const h of hs) results.push(await h({}, {}));
		expect(results).not.toContainEqual({ continue: true });
	});

	it("abort 信号触发后 agent_before_settle 返回空", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));

		const ctrl = new AbortController();
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: ctrl.signal });

		ctrl.abort();

		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("正常 agent_start → agent_end 流程", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));

		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });

		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalled();
	});
});
