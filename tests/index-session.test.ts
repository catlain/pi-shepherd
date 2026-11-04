/**
 * index.ts 测试 — session_start / session_shutdown
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	getHandler,
	makeMockPi,
	mocks,
	shutdownRules,
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

// ── session_start ──
describe("session_start", () => {
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

	it("应调用 checkWorktrees", async () => {
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_start")({}, ctx);
		expect(mocks.checkWorktrees).toHaveBeenCalledWith(ctx.ui);
	});
});

// ── session_shutdown ──
describe("session_shutdown", () => {
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

	it("无 session_shutdown 规则时跳过", async () => {
		mocks.loadRules.mockReturnValue([]);
		await getHandler(pi, "session_shutdown")({}, { ui: { notify: vi.fn() } });
		expect(mocks.hasGitUncommittedChanges).not.toHaveBeenCalled();
	});

	it("check=always 规则触发通知（含 ⚠️ shepherd: 前缀）", async () => {
		mocks.loadRules.mockReturnValue(
			shutdownRules([{ check: "always", reason: "bye" }]),
		);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith("⚠️ shepherd: bye", "warning");
	});

	it("check=git_uncommitted 有未提交时触发（含 ⚠️ shepherd: 前缀）", async () => {
		mocks.loadRules.mockReturnValue(
			shutdownRules([{ check: "git_uncommitted", reason: "git dirty" }]),
		);
		mocks.hasGitUncommittedChanges.mockReturnValue(true);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"⚠️ shepherd: git dirty",
			"warning",
		);
	});

	it("check=git_uncommitted 无更改时跳过", async () => {
		mocks.loadRules.mockReturnValue(
			shutdownRules([{ check: "git_uncommitted", reason: "git dirty" }]),
		);
		mocks.hasGitUncommittedChanges.mockReturnValue(false);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("action 不为 notify 时不触发", async () => {
		const rules = shutdownRules([{ check: "always", reason: "bye" }]);
		rules[0].action = "block";
		mocks.loadRules.mockReturnValue(rules);
		const ctx = { ui: { notify: vi.fn() } };
		await getHandler(pi, "session_shutdown")({}, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});
});
