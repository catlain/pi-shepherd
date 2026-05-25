/**
 * Guard 规则加载 & 工具函数 — 单元测试
 *
 * 测试场景：
 * 1) loadRulesFromFile — 文件读取/JSON 解析/错误处理
 * 2) compileRules — 正则编译/默认值填充/禁用过滤
 * 3) hasGitUncommittedChanges / isInWorktree / isSubagent — 环境检测
 * 4) getMatchTargets — bash 短路逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  loadRulesFromFile,
  compileRules,
  hasGitUncommittedChanges,
  isInWorktree,
  isSubagent,
  getMatchTargets,
  type Rule,
} from "@pi-atelier/shepherd";

// ── 测试临时目录 ──────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), `shepherd-rules-test-${Date.now()}`);

function createTempRules(content: string): string {
  const filePath = path.join(tmpDir, "rules.json");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function cleanup() {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── loadRulesFromFile ─────────────────────────────────────

describe("loadRulesFromFile", () => {
  afterEach(cleanup);

  it("读取有效 JSON 规则", () => {
    const filePath = createTempRules(JSON.stringify([
      { comment: "test rule", pattern: "foo", action: "block" },
    ]));
    const result = loadRulesFromFile(filePath);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].comment).toBe("test rule");
    expect(result.error).toBeUndefined();
  });

  it("空数组不报错", () => {
    const filePath = createTempRules("[]");
    const result = loadRulesFromFile(filePath);
    expect(result.rules).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("文件不存在返回空数组（无 error）", () => {
    const result = loadRulesFromFile("/nonexistent/path/rules.json");
    expect(result.rules).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("无效 JSON 返回空 rules + error 字段", () => {
    const filePath = createTempRules("not valid json");
    const result = loadRulesFromFile(filePath);
    expect(result.rules).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});

// ── compileRules ──────────────────────────────────────────

describe("compileRules", () => {
  it("编译 pattern 为正则", () => {
    const rules: Rule[] = [
      { comment: "r1", pattern: "hello.world", flags: "i" },
    ];
    const compiled = compileRules(rules);
    expect(compiled[0]._compiled).toBeInstanceOf(RegExp);
    expect(compiled[0]._compiled!.test("HELLO.world")).toBe(true);
  });

  it("编译 conditions 中每个条件的 pattern", () => {
    const rules: Rule[] = [
      {
        comment: "r1",
        conditions: [
          { field: "path", pattern: "\\.py$" },
          { field: "text", pattern: "import os" },
        ],
      },
    ];
    const compiled = compileRules(rules);
    expect(compiled[0].conditions![0]._compiled).toBeInstanceOf(RegExp);
    expect(compiled[0].conditions![1]._compiled).toBeInstanceOf(RegExp);
  });

  it("填充默认值：hook=tool_call, tool=bash, action=block", () => {
    const rules: Rule[] = [
      { comment: "r1", pattern: "git push" },
    ];
    const compiled = compileRules(rules);
    expect(compiled[0].hook).toBe("tool_call");
    expect(compiled[0].tool).toBe("bash");
    expect(compiled[0].action).toBe("block");
  });

  it("禁用规则（enabled=false）被过滤", () => {
    const rules: Rule[] = [
      { comment: "r1", pattern: "foo", enabled: false },
      { comment: "r2", pattern: "bar", enabled: true },
      { comment: "r3", pattern: "baz" },
    ];
    const compiled = compileRules(rules);
    expect(compiled).toHaveLength(2);
    expect(compiled[0].comment).toBe("r2");
    expect(compiled[1].comment).toBe("r3");
  });

  it("无 pattern 也无 conditions 的规则不编译 _compiled", () => {
    const rules: Rule[] = [
      { comment: "r1", check: "has_edits", hook: "agent_end" },
    ];
    const compiled = compileRules(rules);
    expect(compiled[0]._compiled).toBeUndefined();
  });

  it("保持已有 action 不覆盖", () => {
    const rules: Rule[] = [
      { comment: "r1", pattern: "foo", action: "steer" },
    ];
    const compiled = compileRules(rules);
    expect(compiled[0].action).toBe("steer");
  });
});

// ── git 辅助函数 ──────────────────────────────────────────

describe("hasGitUncommittedChanges", () => {
  it("返回布尔值", () => {
    const result = hasGitUncommittedChanges();
    expect(typeof result).toBe("boolean");
  });
});

describe("isInWorktree", () => {
  it("返回布尔值", () => {
    const result = isInWorktree();
    expect(typeof result).toBe("boolean");
  });
});

describe("isSubagent", () => {
  it("PI_SUBAGENT_AGENT 环境变量检查", () => {
    const original = process.env.PI_SUBAGENT_AGENT;
    delete process.env.PI_SUBAGENT_AGENT;
    delete process.env.PI_SUBAGENT_SESSION;

    expect(isSubagent()).toBe(false);

    process.env.PI_SUBAGENT_AGENT = "true";
    expect(isSubagent()).toBe(true);

    delete process.env.PI_SUBAGENT_AGENT;
    process.env.PI_SUBAGENT_SESSION = "abc123";
    expect(isSubagent()).toBe(true);

    // 恢复
    if (original) process.env.PI_SUBAGENT_AGENT = original;
    else delete process.env.PI_SUBAGENT_AGENT;
    process.env.PI_SUBAGENT_SESSION = "";
  });
});

// ── getMatchTargets bash 短路 ─────────────────────────────

describe("getMatchTargets bash 短路", () => {
  it("git commit 在 tool_call 阶段返回空 targets", () => {
    const event = { input: { command: "git commit -m 'fix: update deps'" } };
    const result = getMatchTargets("bash", event, "tool_call");
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("cd xxx && git commit 格式也短路", () => {
    const event = { input: { command: "cd repo && git commit -m 'update'" } };
    const result = getMatchTargets("bash", event, "tool_call");
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("git status 不短路（不是 git commit）", () => {
    const event = { input: { command: "git status" } };
    const result = getMatchTargets("bash", event, "tool_call");
    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(result.command).toBe("git status");
  });

  it("tool_result 阶段 git commit 不短路", () => {
    const event = { input: { command: "git commit -m 'fix'" } };
    const result = getMatchTargets("bash", event, "tool_result");
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("无 phase 时默认不短路（兼容旧行为）", () => {
    const event = { input: { command: "git commit -m 'test'" } };
    const result = getMatchTargets("bash", event);
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it("git push 不短路", () => {
    const event = { input: { command: "git push origin main" } };
    const result = getMatchTargets("bash", event, "tool_call");
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });
});
