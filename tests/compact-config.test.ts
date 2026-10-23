/**
 * /compact-config 命令测试 — 两段式全分支：查看两块 / tokens N|on|off / trigger N|无值 /
 * 旧语法迁移提示 / 无效值拒绝 / 无当前模型拒绝。
 * 直接对 commands.ts 单元测试（mock shared-utils 三个 IO 函数），经 makeMockPi 的 _commands 取 handler。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetEffectiveConfig = vi.fn();
const mockGetSettingsValue = vi.fn();
const mockPatch = vi.fn();
const mockPatchBackup = vi.fn().mockReturnValue({ config: {}, errors: [] });
vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: (...a: unknown[]) => mockGetEffectiveConfig(...(a as [])),
	getSettingsValue: (...a: unknown[]) => mockGetSettingsValue(...(a as [])),
	patchSettingsSection: (...a: unknown[]) => mockPatch(...(a as [])),
	patchSettingsSectionWithBackup: (...a: unknown[]) =>
		mockPatchBackup(...(a as [])),
	SETTINGS_PATH: "/mock/settings.json",
}));

import { registerCompactConfigCommand } from "../shepherd/commands";
import { makeMockPi } from "./helpers/message-end-helper";

const MODEL = { provider: "zai", id: "glm-5.3", contextWindow: 1000000 };

const notifies: Array<{ msg: string; level: string }> = [];
const makeCtx = (withModel = true) => ({
	ui: { notify: (msg: string, level: string) => notifies.push({ msg, level }) },
	...(withModel ? { model: MODEL } : {}),
});

let handler: (args: string, ctx: unknown) => Promise<void>;

/** 按调用次序重置 mock 状态 */
function resetEnv(
	compaction = {},
	contextRestore = { enabled: true, maxTokens: 40000 },
) {
	notifies.length = 0;
	mockPatch.mockClear();
	mockPatchBackup.mockClear().mockReturnValue({ config: {}, errors: [] });
	mockGetEffectiveConfig
		.mockReset()
		.mockReturnValue({ config: { contextRestore }, sources: {} });
	mockGetSettingsValue.mockReset().mockReturnValue(compaction);
}

beforeEach(() => {
	resetEnv();
	const pi = makeMockPi();
	registerCompactConfigCommand(pi as unknown as ExtensionAPI);
	const commands = (
		pi as unknown as { _commands: Map<string, { handler: typeof handler }> }
	)._commands;
	handler = commands.get("compact-config")!.handler;
});

describe("无参查看", () => {
	it("显示 contextRestore 块 + 触发点块（有 override）+ 用法", async () => {
		resetEnv({ modelOverrides: { "zai/glm-5.3": { reserveTokens: 800000 } } });
		await handler("", makeCtx());
		const msg = notifies[0].msg;
		expect(msg).toContain("enabled=true maxTokens=40000");
		expect(msg).toContain("zai/glm-5.3 = 200000 tokens");
		expect(msg).toContain("reserveTokens=800000");
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
		expect(mockPatch).toHaveBeenCalledWith(
			"shepherd",
			{ contextRestore: { enabled: true, maxTokens: 50000 } },
			expect.anything(),
		);
		expect(notifies[0].msg).toContain("maxTokens=50000");
	});

	it("tokens 区间外拒绝（500）", async () => {
		await handler("tokens 500", makeCtx());
		expect(mockPatch).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效");
		expect(notifies[0].level).toBe("warning");
	});

	it("tokens off / on 写 enabled", async () => {
		await handler("tokens off", makeCtx());
		expect(mockPatch).toHaveBeenCalledWith(
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

describe("trigger 子命令", () => {
	it("trigger 200000 换算写入 modelOverrides 并确认", async () => {
		resetEnv({ modelOverrides: { "other/model": { reserveTokens: 100 } } });
		await handler("trigger 200000", makeCtx());
		expect(mockPatchBackup).toHaveBeenCalledWith(
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
		expect(notifies[0].msg).toContain("新会话生效");
	});

	it("trigger 区间外拒绝不写盘", async () => {
		await handler("trigger 10000", makeCtx());
		expect(mockPatchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效触发点");
	});

	it("trigger 无当前模型拒绝", async () => {
		await handler("trigger 200000", makeCtx(false));
		expect(mockPatchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无当前模型");
	});

	it("trigger 无值：有 override 删除并确认回默认", async () => {
		resetEnv({ modelOverrides: { "zai/glm-5.3": { reserveTokens: 800000 } } });
		await handler("trigger", makeCtx());
		expect(mockPatchBackup).toHaveBeenCalledWith(
			"compaction",
			{ modelOverrides: {} },
			{},
			{ settingsPath: "/mock/settings.json" },
		);
		expect(notifies[0].msg).toContain("已删除 zai/glm-5.3");
		expect(notifies[0].msg).toContain("16384");
	});

	it("trigger 无值：无 override 幂等提示", async () => {
		await handler("trigger", makeCtx());
		expect(mockPatchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无 override，已是默认行为");
	});

	it("trigger abc 无效", async () => {
		await handler("trigger abc", makeCtx());
		expect(mockPatchBackup).not.toHaveBeenCalled();
		expect(notifies[0].msg).toContain("无效触发点");
	});
});

describe("旧语法迁移与未知参数", () => {
	it("旧裸数字 → 迁移提示两段式", async () => {
		await handler("50000", makeCtx());
		expect(mockPatch).not.toHaveBeenCalled();
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
