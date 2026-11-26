/**
 * /compact-config trigger 子命令测试 — trigger N|无值 / 区间外拒绝 / 无当前模型拒绝 /
 * 写入与删除提示均说明各会话需各自 /reload（pi 内核读进程启动时的内存快照）。
 * mock 方式同 compact-config.test.ts（vi.mock 同样留在文件顶层）；
 * 公共脚手架见 helpers/compact-config-helper.ts。
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

describe("trigger 子命令", () => {
	it("trigger 200000 换算写入 modelOverrides 并确认", async () => {
		resetEnv(mocks, {
			modelOverrides: { "other/model": { reserveTokens: 100 } },
		});
		await handler("trigger 200000", makeCtx());
		expect(mocks.patchBackup).toHaveBeenCalledWith(
			"compaction",
			{
				modelOverrides: {
					"other/model": { reserveTokens: 100 },
					"zai/glm-5.3": { reserveTokens: 800000 },
				},
			},
			{},
			{ settingsPath: "/mock/settings.json" },
		);
		expect(notifies[0].msg).toContain("触发点 = 200000 tokens");
		expect(notifies[0].msg).toContain("reserveTokens=800000");
		expect(notifies[0].msg).toContain("每个已打开的会话都需各自执行 /reload");
	});

	it("trigger 区间外拒绝不写盘", async () => {
		await handler("trigger 10000", makeCtx());
		expect(mocks.patchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效触发点");
	});

	it("trigger 无当前模型拒绝", async () => {
		await handler("trigger 200000", makeCtx(false));
		expect(mocks.patchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无当前模型");
	});

	it("trigger 无值：有 override 删除并确认回默认", async () => {
		resetEnv(mocks, {
			modelOverrides: { "zai/glm-5.3": { reserveTokens: 800000 } },
		});
		await handler("trigger", makeCtx());
		expect(mocks.patchBackup).toHaveBeenCalledWith(
			"compaction",
			{ modelOverrides: {} },
			{},
			{ settingsPath: "/mock/settings.json" },
		);
		expect(notifies[0].msg).toContain("已删除 zai/glm-5.3");
		expect(notifies[0].msg).toContain("16384");
		expect(notifies[0].msg).toContain("每个已打开的会话都需各自执行 /reload");
	});

	it("trigger 无值：无 override 幂等提示", async () => {
		await handler("trigger", makeCtx());
		expect(mocks.patchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无 override，已是默认行为");
	});

	it("trigger abc 无效", async () => {
		await handler("trigger abc", makeCtx());
		expect(mocks.patchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效触发点");
	});
});
