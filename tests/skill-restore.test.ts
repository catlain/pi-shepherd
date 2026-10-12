/**
 * skill-restore 测试 — 谓词/记录器/注入决策/压缩联动
 * Part 1 纯单元直 import；Part 2 全真加载 ../index，tool_result 事件驱动
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	buildRestoreDecision,
	getActiveSkills,
	isSkillRead,
	recordSkillRead,
	resetSkillTracker,
} from "../shepherd/skill-restore";
import {
	makeCtx,
	makeMockPi,
	mockGetEffectiveConfig,
	mockHints,
	mockIsSubagent,
	mockLoadRules,
	mockUiNotify,
} from "./helpers/message-end-helper";

let tmpDir: string;
const skillPath = (name: string) => join(tmpDir, name, "SKILL.md");
const writeSkill = (name: string, content = `# ${name}\nbody`) => {
	const p = skillPath(name);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, content, "utf-8");
	return p;
};

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "skill-restore-"));
});
afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	resetSkillTracker();
});

describe("isSkillRead 谓词", () => {
	it("read × SKILL.md 命中（大小写/反斜杠不敏感）", () => {
		expect(isSkillRead("read", { path: "C:\\skills\\a\\SKILL.md" })).toBe(true);
		expect(isSkillRead("read", { path: "/x/skill.md" })).toBe(true);
	});
	it("非 read 工具 / 非 SKILL.md 路径 / path 非字符串不命中", () => {
		expect(isSkillRead("grep", { path: "a/SKILL.md" })).toBe(false);
		expect(isSkillRead("read", { path: "a/SKILL.txt" })).toBe(false);
		expect(isSkillRead("read", { path: "askill.mdx" })).toBe(false);
		expect(isSkillRead("read", { path: 123 })).toBe(false);
		expect(isSkillRead("read", undefined)).toBe(false);
	});
});

describe("激活集记录", () => {
	it("插入序保最近激活（重读移尾）", () => {
		recordSkillRead("read", { path: "/a/SKILL.md" });
		recordSkillRead("read", { path: "/b/SKILL.md" });
		recordSkillRead("read", { path: "/a/SKILL.md" }); // 重读 a → 移尾
		expect(getActiveSkills()).toEqual(["/b/SKILL.md", "/a/SKILL.md"]);
	});
	it("非技能 read 不入集", () => {
		recordSkillRead("read", { path: "/a/README.md" });
		expect(getActiveSkills()).toEqual([]);
	});
});

describe("buildRestoreDecision 决策", () => {
	it("空集零注入", () => {
		expect(buildRestoreDecision([], { enabled: true, maxSkills: 4, maxTokens: 20000 }))
			.toEqual({ body: "", restored: [], skipped: [] });
	});
	it("读盘失败入 skipped", () => {
		const d = buildRestoreDecision(["/nope/missing/SKILL.md"], { enabled: true, maxSkills: 4, maxTokens: 20000 });
		expect(d.restored).toEqual([]);
		expect(d.skipped).toEqual(["/nope/missing/SKILL.md"]);
	});
	it("超 maxSkills 截断：最近激活优先保留", () => {
		const a = writeSkill("a"), b = writeSkill("b"), c = writeSkill("c");
		const d = buildRestoreDecision([a, b, c], { enabled: true, maxSkills: 2, maxTokens: 20000 });
		expect(d.restored).toEqual([c, b]); // 倒序取最近 2 个
		expect(d.skipped).toEqual([a]); // 最早的被截断
		expect(d.body).toContain("# c");
		expect(d.body).not.toContain("# a");
	});
	it("超 maxTokens 截断入 skipped", () => {
		const big = writeSkill("big", "x".repeat(400)); // ~100 tokens
		const small = writeSkill("small", "y".repeat(8)); // ~2 tokens
		const d = buildRestoreDecision([big, small], { enabled: true, maxSkills: 4, maxTokens: 50 });
		expect(d.skipped).toContain(big);
		expect(d.restored).toEqual([small]); // 超限后继续尝试更小的
	});
	it("边界标记含技能名与路径", () => {
		const p = writeSkill("tagged");
		const d = buildRestoreDecision([p], { enabled: true, maxSkills: 4, maxTokens: 20000 });
		expect(d.body).toContain("===== 技能恢复: tagged");
		expect(d.body).toContain(p);
	});
});

describe("压缩联动（集成：真实 index + tool_result 事件驱动）", () => {
	let pi: ReturnType<typeof makeMockPi>;
	let boot: () => void;
	const SR = { enabled: true, maxSkills: 4, maxTokens: 20000 };
	const setSR = (patch: Partial<typeof SR>) =>
		mockGetEffectiveConfig.mockReturnValue({
			config: {
				projectRulesPattern: "shepherd-rules-",
				maxWarnings: 5,
				skillRestore: { ...SR, ...patch },
			},
			sources: {},
		});
	const steerRule = () =>
		mockLoadRules.mockReturnValue([
			{ hook: "session_compact", comment: "r", action: "steer", reason: "请重读", _compiled: undefined },
		]);
	const fireToolResult = async (toolName: string, input: Record<string, unknown>) => {
		for (const h of pi._handlers.get("tool_result") ?? []) await h({ toolName, input }, makeCtx());
	};
	const fireCompact = async (reason = "threshold") => {
		for (const h of pi._handlers.get("session_compact") ?? [])
			await h({ type: "session_compact", reason, willRetry: false }, makeCtx());
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
	afterEach(() => {
		mockGetEffectiveConfig.mockReturnValue({
			config: { projectRulesPattern: "shepherd-rules-", maxWarnings: 5 },
			sources: {},
		});
	});

	it("注入成功：sendMessage 持久 entry + notify，跳过规则 steer", async () => {
		steerRule();
		boot();
		await fireToolResult("read", { path: writeSkill("s1") });
		await fireCompact();
		expect(pi.sendMessage).toHaveBeenCalledTimes(1);
		const [msg, opts] = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(msg.customType).toBe("shepherd.skillRestore");
		expect(msg.display).toBe(false);
		expect(msg.content).toContain("# s1");
		expect(msg.details.restored).toHaveLength(1);
		expect(opts).toEqual({ triggerTurn: false }); // no-trigger 持久分支
		expect(mockUiNotify).toHaveBeenCalled();
		expect(mockHints).toHaveLength(0); // 规则 steer 被降级抑制
	});

	it("空激活集：零注入，规则提醒维持原行为", async () => {
		steerRule();
		boot();
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(mockHints).toHaveLength(1);
		expect(mockHints[0]?.text).toContain("请重读");
	});

	it("skillRestore 关闭：回落纯提醒", async () => {
		setSR({ enabled: false });
		boot();
		await fireToolResult("read", { path: writeSkill("off") });
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});

	it("截断名单 pushWarning 点名", async () => {
		writeSkill("t1"); writeSkill("t2"); writeSkill("t3"); writeSkill("t4"); writeSkill("t5");
		setSR({ maxSkills: 2 }); // 5 个激活 → 注入 2、截断 3
		boot();
		for (const n of ["t1", "t2", "t3", "t4", "t5"]) await fireToolResult("read", { path: skillPath(n) });
		await fireCompact();
		const sent = (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
		expect(sent).toHaveLength(1);
		expect(mockHints).toHaveLength(1); // 截断点名
		expect(mockHints[0]?.text).toContain(skillPath("t1")); // 最早 3 个被截断，点名含 t1
	});

	it("子代理：跳过恢复注入", async () => {
		mockIsSubagent.mockReturnValue(true);
		boot();
		await fireToolResult("read", { path: writeSkill("sub") });
		await fireCompact();
		expect(pi.sendMessage).not.toHaveBeenCalled();
	});
});
