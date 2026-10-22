/**
 * context-restore 无状态管线测试 — filterContextDocs 适配层 + isContextDocPath
 * 谓词 + buildRestoreDecision 预算决策。激活源为 session_compact 事件 payload
 * 的 readFiles（宿主语义），本文件只测纯函数层。
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
	buildRestoreDecision,
	DEFAULT_CONTEXT_RESTORE,
	filterContextDocs,
	isContextDocPath,
} from "../shepherd/context-restore";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cr-"));
});

/** 写一个临时 SKILL.md，返回绝对路径 */
function writeSkill(name: string, body = "body"): string {
	const dir = join(tmp, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}\n${body}`);
	return join(dir, "SKILL.md");
}

describe("isContextDocPath 谓词", () => {
	it("SKILL.md 后缀命中（大小写不敏感、反斜杠归一）", () => {
		expect(isContextDocPath("C:/a/b/SKILL.md")).toBe(true);
		expect(isContextDocPath("C:\\a\\b\\skill.MD")).toBe(true);
	});
	it("openspec 路径段 .md 命中；普通 .md 不命中", () => {
		expect(isContextDocPath("C:/x/openspec/changes/f/design.md")).toBe(true);
		expect(isContextDocPath("openspec/specs/c/spec.md")).toBe(true);
		expect(isContextDocPath("C:/x/docs/ADR.md")).toBe(false);
		expect(isContextDocPath("README.md")).toBe(false);
	});
});

describe("filterContextDocs 激活源适配", () => {
	it("数组校验：非数组/缺失 → 空清单", () => {
		expect(filterContextDocs(undefined)).toEqual([]);
		expect(filterContextDocs(null)).toEqual([]);
		expect(filterContextDocs("not-array")).toEqual([]);
		expect(filterContextDocs({})).toEqual([]);
	});
	it("谓词过滤 + 非字符串跳过 + 保序去重（继承∪窗口重叠防御）", () => {
		const skill = "C:/a/.pi/skills/s/SKILL.md";
		const design = "C:/r/openspec/changes/c/design.md";
		const out = filterContextDocs([skill, 42, "C:/x/README.md", design, skill]);
		expect(out).toEqual([skill, design]);
	});
	it("尾部 = 最近激活（数组序即激活序语义）", () => {
		const out = filterContextDocs(["C:/o/a/SKILL.md", "C:/o/b/SKILL.md"]);
		expect(out[out.length - 1]).toBe("C:/o/b/SKILL.md");
	});
});

describe("buildRestoreDecision 预算决策", () => {
	it("全量注入：正文含边界标记", () => {
		const p = writeSkill("t1");
		const d = buildRestoreDecision([p], { enabled: true, maxTokens: 40000 });
		expect(d.restored).toEqual([p]);
		expect(d.skipped).toEqual([]);
		expect(d.body).toContain("===== 上下文恢复: t1/SKILL.md");
	});
	it("超 maxTokens 截断：大块被截、小块仍入（预算内最大化）", () => {
		const small = writeSkill("small"); // 块 ~60 tokens
		const big = writeSkill("big", "x".repeat(2000)); // 块 ~510 tokens
		const d = buildRestoreDecision([small, big], { enabled: true, maxTokens: 100 });
		// 倒序：big(~510) 超 100 → skip；small(~60) 入
		expect(d.restored).toEqual([small]);
		expect(d.skipped).toEqual([big]);
		expect(d.body).toContain("# small");
	});
	it("读盘失败（文件已删）进 skipped", () => {
		const gone = join(tmp, "gone", "SKILL.md"); // 从未创建
		const d = buildRestoreDecision([gone], { enabled: true, maxTokens: 40000 });
		expect(d.restored).toEqual([]);
		expect(d.skipped).toEqual([gone]);
	});
	it("DEFAULT_CONTEXT_RESTORE 默认值", () => {
		expect(DEFAULT_CONTEXT_RESTORE).toEqual({ enabled: true, maxTokens: 40000 });
	});
});
