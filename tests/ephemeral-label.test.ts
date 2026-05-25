/**
 * Guard ephemeral — label 参数支持 — 单元测试
 *
 * 测试场景（Step 2 新增功能）：
 * 1) pushWarning(reason, label?) 的 label 存入/取出
 * 2) peekLabels() 返回值
 * 3) notifySummary(text, labels?) 的 labels 参数
 * 4) labels 与 hints 同步消费：drainHints / injectHints 后清空
 * 5) pushHint(hint, label?) 底层 label 传递
 */

import { describe, it, expect, beforeEach } from "vitest";
import { pushWarning, notifySummary } from "@pi-atelier/shepherd";
import {
  pushHint,
  drainHints,
  peekLabels,
} from "@pi-atelier/shepherd";

function resetHints() {
  drainHints();
}

// ── pushWarning label 参数 ────────────────────────────────

describe("pushWarning label 参数", () => {
  beforeEach(resetHints);

  it("无 label 时 peekLabels() 返回空数组", () => {
    pushWarning("no label");
    expect(peekLabels()).toEqual([]);
  });

  it("有 label 时 peekLabels() 返回规则名", () => {
    pushWarning("line too long", "line-count");
    expect(peekLabels()).toEqual(["line-count"]);
  });

  it("多次 pushWarning 不同 label 时 peekLabels() 返回全部", () => {
    pushWarning("file too large", "line-count");
    pushWarning("forbidden import", "import-rule");
    pushWarning("path outside scope", "path-shepherd");
    const labels = peekLabels();
    expect(labels).toContain("line-count");
    expect(labels).toContain("import-rule");
    expect(labels).toContain("path-shepherd");
    expect(labels.length).toBe(3);
  });

  it("重复 label 按实际次数存储（不自动去重）", () => {
    pushWarning("first", "same-rule");
    pushWarning("second", "same-rule");
    expect(peekLabels()).toEqual(["same-rule", "same-rule"]);
  });

  it("混合有 label 和无 label 的 pushWarning", () => {
    pushWarning("no label here");
    pushWarning("has label", "my-rule");
    expect(peekLabels()).toEqual(["my-rule"]);
  });

  it("peekLabels() 不消费标签", () => {
    pushWarning("test", "rule-a");
    pushWarning("test2", "rule-b");
    const first = peekLabels();
    const second = peekLabels();
    expect(first).toEqual(second);
  });

  it("空 label 字符串等价于无 label", () => {
    pushWarning("test", "");
    expect(peekLabels()).toEqual([]);
  });
});

// ── labels 同步消费 ───────────────────────────────────────

describe("labels 消费同步", () => {
  beforeEach(resetHints);

  it("drainHints 后 labels 也被清空", () => {
    pushWarning("test", "my-rule");
    drainHints();
    expect(peekLabels()).toEqual([]);
  });

  it("drainHints 后 labels 也被清空", () => {
    pushWarning("line too long", "line-count");
    drainHints();
    expect(peekLabels()).toEqual([]);
  });

  it("peekLabels 不影响后续 drainHints 清空", () => {
    pushWarning("test", "my-rule");
    peekLabels();
    drainHints();
    expect(peekLabels()).toEqual([]);
  });

  it("无 hints 时 drainHints 不产生 label 残留", () => {
    // 先有 hints，drain 清空
    pushWarning("a", "r1");
    drainHints();
    // 无 hints 再 drain
    const result = drainHints();
    expect(peekLabels()).toEqual([]);
  });
});

// ── notifySummary labels 参数 ─────────────────────────────

describe("notifySummary labels 参数", () => {
  it("有 labels 时优先使用 labels 生成摘要", () => {
    const text = "文件行数超限\n---\n很长很长的细节...";
    const result = notifySummary(text, ["line-count", "path-shepherd"]);
    expect(result).toBe("line-count、path-shepherd");
  });

  it("labels 为单个元素时直接返回", () => {
    const result = notifySummary("some text", ["my-rule"]);
    expect(result).toBe("my-rule");
  });

  it("多个 labels 用顿号拼接", () => {
    const result = notifySummary("text", ["a", "b", "c"]);
    expect(result).toBe("a、b、c");
  });

  it("labels 长度超 120 时截断加省略号", () => {
    const longLabel = "x".repeat(100);
    const result = notifySummary("text", [longLabel, longLabel]);
    expect(result.length).toBe(120);
    expect(result.endsWith("...")).toBe(true);
  });

  it("labels 为空数组时 fallback 到 text 截断", () => {
    const text = "普通摘要";
    const result = notifySummary(text, []);
    expect(result).toBe(text);
  });
});

// ── pushHint 的 label 参数（底层） ─────────────────────────

describe("pushHint label 参数", () => {
  beforeEach(resetHints);

  it("pushHint 无 label 时 peekLabels 为空", () => {
    pushHint("plain hint");
    expect(peekLabels()).toEqual([]);
  });

  it("pushHint 有 label 时可以被 peekLabels 读取", () => {
    pushHint("hint with label", "rule-name");
    expect(peekLabels()).toEqual(["rule-name"]);
  });

  it("多个 pushHint 不同 label 时累加", () => {
    pushHint("a", "rule-a");
    pushHint("b", "rule-b");
    pushHint("c");
    expect(peekLabels()).toEqual(["rule-a", "rule-b"]);
  });

  it("pushHint 空字符串 label 等价于无 label", () => {
    pushHint("test", "");
    expect(peekLabels()).toEqual([]);
  });
});

// ── 边界情况 ──────────────────────────────────────────────

describe("label 边界情况", () => {
  beforeEach(resetHints);

  it("label 含特殊字符", () => {
    pushWarning("test", "rule-name_with.special-chars");
    expect(peekLabels()).toEqual(["rule-name_with.special-chars"]);
  });

  it("非常长的 label", () => {
    const longLabel = "a".repeat(200);
    pushWarning("test", longLabel);
    expect(peekLabels()).toEqual([longLabel]);
  });

  it("先 drainHints 再 pushWarning 有 label 正常工作", () => {
    drainHints();
    pushWarning("fresh", "fresh-rule");
    expect(peekLabels()).toEqual(["fresh-rule"]);
  });
});
