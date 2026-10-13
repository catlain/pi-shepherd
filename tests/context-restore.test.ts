/**
 * context-restore 测试 — 谓词/记录器/注入决策/压缩联动。
 * Part 1 纯单元直 import；Part 2 全真加载 ../index，tool_execution_start 事件驱动
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildRestoreDecision, getActiveDocs, isContextDocRead, recordContextRead, resetContextTracker,
} from "../shepherd/context-restore";
import {
	makeCtx, makeMockPi, mockGetEffectiveConfig, mockHints, mockIsSubagent, mockLoadRules, mockUiNotify,
} from "./helpers/message-end-helper";

let tmpDir: string;
const skillPath = (n: string) => join(tmpDir, n, "SKILL.md");
const docPath = (n: string) => join(tmpDir, "openspec", "changes", n, "design.md");
const mk = (p: string, content: string) => {
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, content, "utf-8");
	return p;
};
const writeSkill = (n: string, c = `# ${n}\nbody`) => mk(skillPath(n), c);
const writeDoc = (n: string, c = `# ${n}\ndoc`) => mk(docPath(n), c);

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "context-restore-"));
});
afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	resetContextTracker();
});

describe("isContextDocRead 谓词", () => {
	it("read × SKILL.md 命中（大小写/反斜杠不敏感）", () => {
		expect(isContextDocRead("read", { path: "C:\\skills\\a\\SKILL.md" })).toBe(true);
		expect(isContextDocRead("read", { path: "/x/skill.md" })).toBe(true);
	});
	it("read × openspec 下 .md 命中（changes/specs，含反斜杠）", () => {
		expect(isContextDocRead("read", { path: join(tmpDir, "openspec", "changes", "c1", "design.md") })).toBe(true);
		expect(isContextDocRead("read", { path: join(tmpDir, "openspec", "specs", "foo", "spec.md") })).toBe(true);
		expect(isContextDocRead("read", { path: "openspec\\changes\\c1\\tasks.md" })).toBe(true);
	});
	it("非 read 工具 / 普通 .md / path 非字符串不命中", () => {
		expect(isContextDocRead("grep", { path: "openspec/changes/c1/design.md" })).toBe(false);
		expect(isContextDocRead("read", { path: "docs/agent/ADR.md" })).toBe(false);
		expect(isContextDocRead("read", { path: "README.md" })).toBe(false);
		expect(isContextDocRead("read", { path: "a/SKILL.txt" })).toBe(false);
		expect(isContextDocRead("read", { path: 123 })).toBe(false);
		expect(isContextDocRead("read", undefined)).toBe(false);
	});
});

describe("激活集记录", () => {
	it("插入序保最近激活（重读移尾），技能与文档共池单序", () => {
		const a = writeSkill("a"), b = writeDoc("b"), c = writeSkill("c");
		recordContextRead("read", { path: a });
		recordContextRead("read", { path: b });
		recordContextRead("read", { path: c });
		recordContextRead("read", { path: a }); // 重读 a → 移尾
		expect(getActiveDocs()).toEqual([b, c, a]);
	});
	it("非上下文 read / 不存在文件（ENOENT）不入集", () => {
		recordContextRead("read", { path: join(tmpDir, "README.md") });
		recordContextRead("read", { path: join(tmpDir, "no-such", "SKILL.md") });
		recordContextRead("read", { path: docPath("ghost") }); // openspec 但不存在
		expect(getActiveDocs()).toEqual([]);
	});
});

describe("buildRestoreDecision 决策", () => {
	it("空集零注入 / 读盘失败入 skipped", () => {
		const cfg = { enabled: true, maxTokens: 40000 };
		expect(buildRestoreDecision([], cfg)).toEqual({ body: "", restored: [], skipped: [] });
		const d = buildRestoreDecision(["/nope/missing/SKILL.md"], cfg);
		expect(d.restored).toEqual([]);
		expect(d.skipped).toEqual(["/nope/missing/SKILL.md"]);
	});
	it("超 maxTokens 截断入 skipped（超限继续尝试更小的）", () => {
		const big = writeSkill("big", "x".repeat(400)); // ~100 tokens
		const small = writeSkill("small", "y".repeat(8)); // ~2 tokens
		const d = buildRestoreDecision([big, small], { enabled: true, maxTokens: 50 });
		expect(d.skipped).toContain(big);
		expect(d.restored).toEqual([small]);
	});
	it("边界标记为两段式显示名与完整路径", () => {
		const p = writeSkill("tagged");
		const d = buildRestoreDecision([p], { enabled: true, maxTokens: 40000 });
		expect(d.body).toContain("===== 上下文恢复: tagged/SKILL.md");
		expect(d.body).toContain(p);
	});
});

describe("压缩联动（集成：真实 index + tool_execution_start 事件驱动）", () => {
	let pi: ReturnType<typeof makeMockPi>;
	let boot: () => void;
	const SR = { enabled: true, maxTokens: 40000 };
	const setSR = (patch: Partial<typeof SR>) => mockGetEffectiveConfig.mockReturnValue({
		config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5, contextRestore: { ...SR, ...patch } },
		sources: {},
	});
	const steerRule = () => mockLoadRules.mockReturnValue([
		{ hook: "session_compact", comment: "r", action: "steer", reason: "请重读", _compiled: undefined },
	]);
	const fireToolExecStart = async (toolName: string, args: Record<string, unknown>) => {
		for (const h of pi._handlers.get("tool_execution_start") ?? []) await h({ toolName, args }, makeCtx());
	};
	const fireCompact = async (reason = "threshold") => {
		for (const h of pi._handlers.get("session_compact") ?? []) await h({ type: "session_compact", reason, willRetry: false }, makeCtx());
	};

	beforeEach(async () => {
		mockHints.length = 0;
		mockLoadRules.mockReturnValue([]);
		mockIsSubagent.mockReturnValue(false);
		setSR({}); // 默认启用；需覆盖的用例在 boot 前调 setSR
		vi.resetModules();
		const mod = await import("../index");
		pi = makeMockPi();
		boot = () => mod.default(pi as unknown as ExtensionAPI);
	});
	afterEach(() => mockGetEffectiveConfig.mockReturnValue({
		config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 }, sources: {},
	}));

	it("注入成功：sendMessage 持久 entry + notify，跳过规则 steer", async () => {
		steerRule();
		boot();
		await fireToolExecStart("read", { path: writeSkill("s1") });
		await fireCompact();
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		const [msg, opts] = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(msg.customType).toBe("shepherd.contextRestore");
		expect(msg.display).toBe(false);
		expect(msg.content).toContain("# s1");
		expect(msg.details.restored).toHaveLength(1);
		expect(opts).toEqual({ triggerTurn: false }); // no-trigger 持久分支
		expect(mockUiNotify).toHaveBeenCalled();
		expect(mockHints).toHaveLength(0); // 规则 steer 被降级抑制
	});
	it("openspec 文档与技能共池注入", async () => {
		boot();
		await fireToolExecStart("read", { path: writeSkill("sk") });
		await fireToolExecStart("read", { path: writeDoc("chg") });
		await fireCompact();
		const [msg] = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(msg.content).toContain("# sk");
		expect(msg.content).toContain("# chg"); // openspec design.md 正文同批恢复
		expect(msg.details.restored).toHaveLength(2);
	});

	it("空激活集：零注入，规则提醒维持原行为", async () => {
		steerRule();
		boot();
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(mockHints).toHaveLength(1);
		expect(mockHints[0]?.text).toContain("请重读");
	});

	it("contextRestore 关闭：回落纯提醒", async () => {
		setSR({ enabled: false });
		boot();
		await fireToolExecStart("read", { path: writeSkill("off") });
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it("截断名单 pushWarning 点名", async () => {
		writeSkill("t1"); writeSkill("t2"); writeSkill("t3"); writeSkill("t4"); writeSkill("t5");
		setSR({ maxTokens: 45 }); // 小预算：每块 ~38 tokens → 仅最近 1 个入、其余 4 个截断
		boot();
		for (const n of ["t1", "t2", "t3", "t4", "t5"]) await fireToolExecStart("read", { path: skillPath(n) });
		await fireCompact();
		const sent = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
		expect(sent).toHaveLength(1);
		expect(mockHints).toHaveLength(1); // 截断点名
		expect(mockHints[0]?.text).toContain(skillPath("t1")); // 最早 3 个被截断，点名含 t1
	});

	it("子代理：跳过恢复注入", async () => {
		mockIsSubagent.mockReturnValue(true);
		boot();
		await fireToolExecStart("read", { path: writeSkill("sub") });
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});
});
