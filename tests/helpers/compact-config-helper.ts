/**
 * /compact-config 命令测试脚手架：模型夹具、ctx 构造、notify 捕获、mock 状态重置、
 * handler 提取。shared-utils 的 vi.mock 与 mock 句柄留在各测试文件顶层（与拆分前
 * 的单文件写法同构），本模块只接收各文件自建的 mock 句柄。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Mock } from "vitest";
import { registerCompactConfigCommand } from "../../shepherd/commands";
import { makeMockPi } from "./message-end-helper";

export type Handler = (args: string, ctx: unknown) => Promise<void>;
type NotifyRecord = { msg: string; level: string };

export const MODEL = {
	provider: "zai",
	id: "glm-5.3",
	contextWindow: 1000000,
};

export const notifies: NotifyRecord[] = [];

export const makeCtx = (withModel = true) => ({
	ui: {
		notify: (msg: string, level: string) => notifies.push({ msg, level }),
	},
	...(withModel ? { model: MODEL } : {}),
});

export interface SharedUtilsMocks {
	getEffectiveConfig: Mock;
	getSettingsValue: Mock;
	patch: Mock;
	patchBackup: Mock;
}

/** 按调用次序重置 mock 状态（compaction = 全局 compaction section 原始 JSON） */
export function resetEnv(
	m: SharedUtilsMocks,
	compaction = {},
	contextRestore: { enabled: boolean; maxTokens: number } = {
		enabled: true,
		maxTokens: 40000,
	},
): void {
	notifies.length = 0;
	m.patch.mockClear();
	m.patchBackup.mockClear().mockReturnValue({ config: {}, errors: [] });
	m.getEffectiveConfig
		.mockReset()
		.mockReturnValue({ config: { contextRestore }, sources: {} });
	m.getSettingsValue.mockReset().mockReturnValue(compaction);
}

/** 注册命令并取出 handler（每个测试文件在 beforeEach 调一次） */
export function getHandler(): Handler {
	const pi = makeMockPi();
	registerCompactConfigCommand(pi as unknown as ExtensionAPI);
	return (
		pi as unknown as { _commands: Map<string, { handler: Handler }> }
	)._commands.get("compact-config")!.handler;
}
