/**
 * /compact-config 命令测试 — 分支覆盖：无参查看 / 裸数字设 maxTokens / on|off / 无效值。
 * 直接对 commands.ts 单元测试（mock shared-utils），经 makeMockPi 的 _commands 取 handler。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const mockGetEffectiveConfig = vi.fn().mockReturnValue({
	config: { contextRestore: { enabled: true, maxTokens: 40000 } },
	sources: {},
});
const mockPatch = vi.fn();
vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...a: unknown[]) => mockGetEffectiveConfig(...(a as [])),
	patchSettingsSection: (...a: unknown[]) => mockPatch(...(a as [])),
}));

import { registerCompactConfigCommand } from "../shepherd/commands";
import { makeMockPi } from "./helpers/message-end-helper";

const notifies: Array<{ msg: string; level: string }> = [];
const ctx = { ui: { notify: (msg: string, level: string) => notifies.push({ msg, level }) } };

let handler: (args: string, ctx2: unknown) => Promise<void>;
beforeEach(() => {
	notifies.length = 0;
	mockPatch.mockClear();
	const pi = makeMockPi();
	registerCompactConfigCommand(pi as unknown as ExtensionAPI);
	handler = pi._commands.get("compact-config")!.handler as typeof handler;
});

describe("/compact-config 命令", () => {
	it("无参：展示当前配置与用法", async () => {
		await handler("", ctx);
		expect(notifies).toHaveLength(1);
		expect(notifies[0]!.msg).toContain("enabled=true maxTokens=40000");
		expect(notifies[0]!.msg).toContain("用法");
	});
	it("裸数字：设 maxTokens 并写入 settings", async () => {
		await handler("50000", ctx);
		expect(mockPatch).toHaveBeenCalledWith("shepherd", {
			contextRestore: { enabled: true, maxTokens: 50000 },
		}, { contextRestore: { enabled: true, maxTokens: 40000 } });
		expect(notifies[0]!.msg).toContain("maxTokens=50000");
	});
	it("on / off：开关 enabled", async () => {
		await handler("off", ctx);
		expect(mockPatch).toHaveBeenCalledWith("shepherd", {
			contextRestore: { enabled: false, maxTokens: 40000 },
		}, expect.anything());
		await handler("on", ctx);
		expect(notifies[1]!.msg).toContain("enabled=true");
	});
	it("无效值拒绝：过小数字 / 非数字 / 废弃子词", async () => {
		await handler("8", ctx); // < 1000
		await handler("abc", ctx);
		await handler("tokens 50000", ctx); // tokens 子命令已废弃 → 未知参数
		expect(mockPatch).not.toHaveBeenCalled();
		expect(notifies).toHaveLength(3);
		expect(notifies.every((n) => n.level === "warning")).toBe(true);
	});
	it("写入合并当前配置（读当前→合并 patch→整体写回）", async () => {
		mockGetEffectiveConfig.mockReturnValueOnce({
			config: { contextRestore: { enabled: true, maxTokens: 10000 } },
			sources: {},
		});
		await handler("99999", ctx);
		expect(mockPatch).toHaveBeenCalledWith("shepherd", {
			contextRestore: { enabled: true, maxTokens: 99999 }, // 写入合并当前配置
		}, expect.anything());
	});
});
