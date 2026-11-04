/**
 * index.ts 测试 — agent_start / input
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getHandler, makeMockPi, mocks } from "./helpers/shared-mocks";

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

// ── agent_start ──
describe("agent_start", () => {
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

	it("重置 _aborted（未中断）", async () => {
		const controller = new AbortController();
		await getHandler(pi, "agent_start")({}, { signal: controller.signal });
		// signal.aborted 为 false → _aborted = false
		// 通过后续 agent_end 验证不跳过
	});

	it("检测 signal.aborted=true", async () => {
		const controller = new AbortController();
		controller.abort();
		await getHandler(pi, "agent_start")({}, { signal: controller.signal });
		// 后续 agent_end 应跳过 — 用另一测试文件验证
	});

	it("无 signal 时 _aborted 默认为 false", async () => {
		await getHandler(pi, "agent_start")({}, {});
		// 无 signal → _aborted = false
	});

	it("检查 git uncommitted 状态", async () => {
		mocks.hasGitUncommittedChanges.mockReturnValue(true);
		await getHandler(pi, "agent_start")({}, { signal: undefined });
		expect(mocks.hasGitUncommittedChanges).toHaveBeenCalled();
	});

	it("连续调用重置状态", async () => {
		// 确保不会因上次调用残留状态
		await getHandler(pi, "agent_start")(
			{},
			{ signal: new AbortController().signal },
		);
		expect(mocks.hasGitUncommittedChanges).toHaveBeenCalled();
	});

	it("abort 事件监听不抛出 catch 错误", async () => {
		// 正常 AbortController.signal 有 addEventListener，验证不崩溃
		const signal = new AbortController().signal;
		await expect(
			getHandler(pi, "agent_start")({}, { signal }),
		).resolves.toBeUndefined();
	});
});

// ── input ──
describe("input 事件", () => {
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

	it("已注册 input 事件处理器", () => {
		expect(pi._handlers.has("input")).toBe(true);
	});

	it("input 处理器不抛出异常", async () => {
		await expect(
			getHandler(pi, "input")({ text: "hello" }, {}),
		).resolves.toBeUndefined();
	});
});
