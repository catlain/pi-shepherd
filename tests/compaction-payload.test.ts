/**
 * session_compact payload 激活源集成测试 — restore-from-compaction-payload
 *
 * 验证：readFiles 谓词过滤注入 / 空集 debug 观测 / 事件缺 payload 容错 /
 * 恢复成功时 steer 跳过联动。规则匹配矩阵见 index-compaction.test.ts。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	makeCtx,
	makeMockPi,
	mockGetEffectiveConfig,
	mockHints,
	mockIsSubagent,
	mockLoadRules,
} from "./helpers/message-end-helper";
import { logRestore } from "../shepherd/restore-log";

// 恢复审计日志 mock：拦截真实写盘（~/.pi/agent/logs/）并供断言
vi.mock("../shepherd/restore-log", () => ({ logRestore: vi.fn() }));

let shepherdExtension: (pi: ExtensionAPI) => void;
// helpers 的共享 vi.mock 覆盖本文件同名 mock（后注册胜出）——不另建
// vi.mock，直接定制共享 mockGetEffectiveConfig 返回 contextRestore。

/** 触发 session_compact 事件（携带宿主 compactionEntry payload） */
async function fireCompact(readFiles: unknown) {
	const pi = (fireCompact as unknown as { _pi?: ReturnType<typeof makeMockPi> })._pi!;
	const hs = pi._handlers.get("session_compact");
	expect(hs).toBeDefined();
	for (const h of hs!) {
		await h(
			{
				type: "session_compact",
				reason: "threshold",
				willRetry: false,
				compactionEntry: { details: { readFiles } },
			},
			makeCtx(),
		);
	}
}

describe("session_compact — payload 激活源注入", () => {
	let pi: ReturnType<typeof makeMockPi>;
	let tmp: string;
	let skillPath: string;
	let designPath: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockGetEffectiveConfig.mockReturnValue({
			config: { contextRestore: { enabled: true, maxTokens: 40000 } },
			sources: {},
		});
		mockHints.length = 0;
		mockLoadRules.mockReturnValue([]);
		mockIsSubagent.mockReturnValue(false);
		vi.useFakeTimers();
		vi.resetModules();
		const mod = await import("../index");
		shepherdExtension = mod.default;
		pi = makeMockPi();
		(fireCompact as unknown as { _pi?: typeof pi })._pi = pi;
		shepherdExtension(pi as unknown as ExtensionAPI);

		tmp = mkdtempSync(join(tmpdir(), "cp-"));
		const sdir = join(tmp, "my-skill");
		mkdirSync(sdir, { recursive: true });
		skillPath = join(sdir, "SKILL.md");
		writeFileSync(skillPath, "---\nname: my-skill\n---\n# my-skill\n正文");
		const ddir = join(tmp, "openspec", "changes", "c");
		mkdirSync(ddir, { recursive: true });
		designPath = join(ddir, "design.md");
		writeFileSync(designPath, "# Design\n正文");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("readFiles 命中谓词 → sendMessage 持久注入（含边界标记，非命中过滤）", async () => {
		await fireCompact([skillPath, "C:/x/README.md", designPath]);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		const [msg, opts] = pi.sendMessage.mock.calls[0] as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(msg.customType).toBe("shepherd.contextRestore");
		expect(opts.triggerTurn).toBe(false);
		const content = String(msg.content);
		expect(content).toContain("===== 上下文恢复: my-skill/SKILL.md");
		expect(content).toContain("===== 上下文恢复: c/design.md");
		expect(content).not.toContain("README");
	});

	it("空集（readFiles 无命中）→ 日志 empty 行、零注入", async () => {
		await fireCompact(["C:/x/README.md", "C:/y/docs/ADR.md"]);
		expect(pi.sendMessage).not.toHaveBeenCalled();
		const logged = vi.mocked(logRestore).mock.calls.map((c) => String(c[0]));
		expect(logged.some((l) => l.startsWith("empty"))).toBe(true);
	});

	it("事件缺 payload（旧形态）→ 容错为空集，不崩溃", async () => {
		const hs = pi._handlers.get("session_compact");
		for (const h of hs!) {
			await h({ type: "session_compact", reason: "manual", willRetry: false }, makeCtx());
		}
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it("恢复注入成功 → compaction 规则 steer 跳过（正文已恢复无需引导重读）", async () => {
		mockLoadRules.mockReturnValue([
			{
				hook: "session_compact",
				comment: "steer-remind",
				action: "steer",
				reason: "正文挥发",
			},
		] as never);
		await fireCompact([skillPath]);
		expect(pi.sendMessage).toHaveBeenCalledTimes(1); // 恢复注入
		const logged = vi.mocked(logRestore).mock.calls.map((c) => String(c[0]));
		expect(logged.some((l) => l.startsWith("ok") && l.includes("restored=1"))).toBe(
			true,
		); // 成功审计行
		expect(mockHints).toHaveLength(0); // steer 跳过
	});
});
