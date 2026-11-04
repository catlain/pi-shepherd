/**
 * index.ts 测试 — agent_end check 类型
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

describe("agent_end — check 类型", () => {
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

	it("check=always 触发通知", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalled();
	});

	it("check=undefined 视为 always", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: undefined }]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalled();
	});

	it("action 不为 notify 时不触发", async () => {
		mocks.loadRules.mockReturnValue(
			makeRules([{ action: "block", check: "always" }]),
		);
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("check=git_dirty AND has_edits: 有更改 + 有编辑时触发", async () => {
		mocks.hasGitUncommittedChanges.mockReturnValue(true);
		mocks.loadRules.mockReturnValue(
			makeRules([
				{
					conditions: [{ builtin: "git_dirty" }, { builtin: "has_edits" }],
					conditionLogic: "and",
					reason: "git dirty",
				},
			]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!) await h({}, {});

		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalledWith("git dirty", "test-rule");
	});

	it("conditions git_dirty: 无更改时跳过", async () => {
		mocks.hasGitUncommittedChanges.mockReturnValue(false);
		mocks.loadRules.mockReturnValue(makeRules([{ check: "git_uncommitted" }]));
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("check=has_edits: 有编辑时触发", async () => {
		mocks.loadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		for (const h of pi._handlers.get("agent_start")!)
			await h({}, { signal: new AbortController().signal });
		for (const h of pi._handlers.get("tool_call")!) await h({}, {});

		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).toHaveBeenCalledWith("edit detected", "test-rule");
	});

	it("check=has_edits: 无编辑时跳过", async () => {
		mocks.loadRules.mockReturnValue(
			makeRules([{ check: "has_edits", reason: "edit detected" }]),
		);
		await fire(makeEvent("stop"));
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	// ── 问句跳过测试 ──
	it("问句结尾时跳过 agent_end 通知", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "你觉得这个方案OK吗？", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("英文问号结尾时也跳过", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "What do you think?", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});

	it("非问句结尾时正常触发", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const normalEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "好的，已经完成修改。", stopReason: "stop" },
			],
		};
		await fire(normalEvent);
		expect(mocks.pushWarning).toHaveBeenCalled();
	});

	it("问句后缀模式也跳过（要不要、可以吗、你觉得）", async () => {
		mocks.loadRules.mockReturnValue(makeRules([{ check: "always" }]));
		const questionEvent = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "这个方向你要不要试试看", stopReason: "stop" },
			],
		};
		await fire(questionEvent);
		expect(mocks.pushWarning).not.toHaveBeenCalled();
	});
});
