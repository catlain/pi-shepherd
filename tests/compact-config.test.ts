/**
 * /compact-config 命令测试（非 trigger 部分）— 无参查看两块 / tokens N|on|off /
 * 旧语法迁移提示 / 未知参数。trigger 子命令见 compact-config-trigger.test.ts。
 * 直接对 commands.ts 单元测试（mock shared-utils 四个 IO 函数），经 makeMockPi 的
 * _commands 取 handler；公共脚手架见 helpers/compact-config-helper.ts。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
	getEffectiveConfig: vi.fn(),
	getSettingsValue: vi.fn(),
	patch: vi.fn(),
	patchBackup: vi.fn().mockReturnValue({ config: {}, errors: [] }),
};
vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...a: unknown[]) =>
		mocks.getEffectiveConfig(...(a as [])),
	getSettingsValue: (...a: unknown[]) => mocks.getSettingsValue(...(a as [])),
	patchSettingsSection: (...a: unknown[]) => mocks.patch(...(a as [])),
	patchSettingsSectionWithBackup: (...a: unknown[]) =>
		mocks.patchBackup(...(a as [])),
	SETTINGS_PATH: "/mock/settings.json",
}));

import {
	getHandler,
	type Handler,
	makeCtx,
	notifies,
	resetEnv,
} from "./helpers/compact-config-helper";

let handler: Handler;

beforeEach(() => {
	resetEnv(mocks);
	handler = getHandler();
});

describe("无参查看", () => {
	it("显示 contextRestore 块 + 触发点块（有 override）+ 用法", async () => {
		resetEnv(mocks, {
			modelOverrides: { "zai/glm-5.3": { reserveTokens: 800000 } },
		});
		await handler("", makeCtx());
		const msg = notifies[0].msg;
		expect(msg).toContain("enabled=true maxTokens=40000");
		expect(msg).toContain("zai/glm-5.3 = 200000 tokens");
		expect(msg).toContain("reserveTokens=800000");
		expect(msg).toContain("磁盘值");
		expect(msg).toContain("用法");
		expect(notifies[0].level).toBe("info");
	});

	it("无 override 显示默认行", async () => {
		await handler("", makeCtx());
		expect(notifies[0].msg).toContain("默认");
	});

	it("无当前模型时触发点块降级提示", async () => {
		await handler("", makeCtx(false));
		expect(notifies[0].msg).toContain("无当前模型");
	});
});

describe("tokens 子命令", () => {
	it("tokens 50000 写 maxTokens 并确认", async () => {
		await handler("tokens 50000", makeCtx());
		expect(mocks.patch).toHaveBeenCalledWith(
			"shepherd",
			{ contextRestore: { enabled: true, maxTokens: 50000 } },
			expect.anything(),
		);
		expect(notifies[0].msg).toContain("maxTokens=50000");
	});

	it("tokens 区间外拒绝（500）", async () => {
		await handler("tokens 500", makeCtx());
		expect(mocks.patch).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效");
		expect(notifies[0].level).toBe("warning");
	});

	it("tokens off / on 写 enabled", async () => {
		await handler("tokens off", makeCtx());
		expect(mocks.patch).toHaveBeenCalledWith(
			"shepherd",
			{ contextRestore: { enabled: false, maxTokens: 40000 } },
			expect.anything(),
		);
		await handler("tokens on", makeCtx());
		expect(notifies[1].msg).toContain("enabled=true");
	});

	it("tokens abc 无效参数", async () => {
		await handler("tokens abc", makeCtx());
		expect(notifies[0].msg).toContain("无效参数");
	});

	it("tokens 缺值提示用法", async () => {
		await handler("tokens", makeCtx());
		expect(notifies[0].msg).toContain("需要参数");
	});
});

describe("旧语法迁移与未知参数", () => {
	it("旧裸数字 → 迁移提示两段式", async () => {
		await handler("50000", makeCtx());
		expect(mocks.patch).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("/compact-config tokens 50000");
	});

	it("旧裸 on/off → 迁移提示", async () => {
		await handler("off", makeCtx());
		expect(notifies[0].msg).toContain("/compact-config tokens off");
	});

	it("未知子命令 → 未知参数", async () => {
		await handler("abc", makeCtx());
		expect(notifies[0].msg).toContain("未知参数");
	});
});
