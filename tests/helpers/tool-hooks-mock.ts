/**
 * tool-hooks 测试共享 mock 工厂
 *
 * 提供 createMockToolState / createMockPi，类型对齐 shepherd 的 ToolState
 * 与 SDK 的 ExtensionAPI，消除各 tool-hooks*.test.ts 重复定义 + 类型失配。
 *
 * 用法（配合 vi.mock 拦截依赖）：
 *   const state = createMockToolState();
 *   const pi = createMockPi();
 *   registerToolCall(pi as any, state);
 */

import { vi } from "vitest";
import type { ToolState } from "../../shepherd/tool-hooks";

/** 记录 handler 注册，供测试触发 */
export interface MockPi {
	handlers: Record<string, Function>;
	on: ReturnType<typeof vi.fn>;
	getActiveTools: ReturnType<typeof vi.fn>;
}

/**
 * 创建符合 ToolState 类型的 mock。
 * tracker 用结构化 mock（对齐 StateTracker 的公共方法签名），
 * 可通过 override 按需定制。
 */
export function createMockToolState(
	override?: Partial<ToolState> & { tracker?: Record<string, unknown> },
): ToolState {
	const defaultTracker = {
		update: vi.fn(),
		resetIf: vi.fn(),
		isTriggered: vi.fn(() => false),
		nextThreshold: vi.fn((n: number) => n),
		getStats: vi.fn(() => ({ count: 0, chars: 0, errors: 0 })),
		matches: vi.fn(() => false),
		markTriggered: vi.fn(),
	};
	return {
		hasEdits: false,
		tracker: (override?.tracker ?? defaultTracker) as ToolState["tracker"],
		cachedTools: null,
		...override,
	} as ToolState;
}

/**
 * 创建符合 ExtensionAPI 最小子集的 mock（on + getActiveTools）。
 * 调用方按需 `as ExtensionAPI` 或 `as any` 传入 registerToolCall。
 */
export function createMockPi(): MockPi {
	const handlers: Record<string, Function> = {};
	return {
		handlers,
		on: vi.fn((event: string, handler: Function) => {
			handlers[event] = handler;
		}),
		getActiveTools: vi.fn(() => ["edit", "write", "bash", "read", "grep"]),
	};
}
