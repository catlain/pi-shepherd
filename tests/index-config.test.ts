/**
 * index.ts 测试 — 扩展注册、config、ephemeral:hint
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	fireSystemEvent,
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
describe("shepherdExtension 注册 & config", () => {
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

	it("应注册所有 pi 事件", () => {
		const expected = [
			"before_provider_request",
			"session_start",
			"agent_start",
			"input",
			"agent_end",
			"session_shutdown",
		];
		for (const evt of expected) {
			expect(pi._handlers.has(evt)).toBe(true);
		}
	});

	it("应注册 ephemeral:hint 系统事件", () => {
		expect(pi._systemEvents.has("ephemeral:hint")).toBe(true);
	});

	it("应注册 tool_call/tool_result 子模块（注意：config 嵌套在 .config 下）", () => {
		expect(mocks.registerToolCall).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({ hasEdits: false, cachedTools: null }),
			expect.any(String),
			expect.objectContaining({ projectRulesPattern: "shepherd-rules-" }),
		);
		expect(mocks.registerToolResult).toHaveBeenCalledWith(
			pi,
			expect.objectContaining({ hasEdits: false, cachedTools: null }),
			expect.any(String),
			expect.objectContaining({ projectRulesPattern: "shepherd-rules-" }),
		);
	});

	it("应注册 rules editor 工具", async () => {
		// registerRulesEditorTool 被 vi.mock 为 vi.fn()，验证曾调用
		const rulesToolMod = await import("../shepherd/rules-tool");
		const rulesTool = vi.mocked(rulesToolMod);
		expect(rulesTool.registerRulesEditorTool).toHaveBeenCalledWith(
			pi,
			expect.any(String), // rulesDir
			expect.any(String), // cwd
		);
	});

	it("应在注册时调用 getEffectiveConfig", () => {
		expect(mocks.getEffectiveConfig).toHaveBeenCalledWith("shepherd", {
			projectRulesPattern: "shepherd-rules-",
			maxWarnings: 5,
			contextRestore: mocks.contextRestore,
		}, process.cwd());
	});

	// ── ephemeral:hint ──

	describe("ephemeral:hint", () => {
		it("应缓存 hint 并可被请求消耗", async () => {
			fireSystemEvent(pi, "ephemeral:hint", {
				text: "memory hint",
				short: "hint",
			});

			mocks.drainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0]({ payload: { messages: [] } }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});

		it("多个 hints 合并注入", async () => {
			fireSystemEvent(pi, "ephemeral:hint", { text: "hint A" });
			fireSystemEvent(pi, "ephemeral:hint", { text: "hint B" });

			mocks.drainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0]({ payload: { messages: [] } }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});

		it("hint 无 short 也能工作", async () => {
			fireSystemEvent(pi, "ephemeral:hint", {
				text: "long only",
			});
			mocks.drainHints.mockReturnValue("");
			const ctx = { ui: { notify: vi.fn() } };
			const hs = pi._handlers.get("before_provider_request")!;
			await hs[0]({ payload: { messages: [] } }, ctx);

			expect(ctx.ui.notify).toHaveBeenCalled();
		});
	});
});
