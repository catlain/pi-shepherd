/**
 * D3 bash 防绕过正则词边界测试（fix-rules-update-validation Task 5）
 *
 * 锁定 global:33 新 pattern（词边界版）的匹配行为：
 * - 只读命令不再被 catlain 子串/误伤（10-12 复现的事故形态）
 * - 真危险读写命令仍被拦截
 *
 * 注：`\bwrite\b` 不匹配 writeFileSync 属已知残留——工具直写路径由
 * 另一条 edit/write 规则（block shepherd/rules\.json$）独立覆盖，见 design D3。
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";

// 与全局 global:33 已更新的 pattern 保持一致（词边界版）
const PATTERN =
	"(rules\\.json[\\s\\S]*(open\\(|json\\.load|json\\.dump|\\bwrite\\b|sed|awk|jq|\\bcat\\b))|((open\\(|json\\.load|json\\.dump|\\bwrite\\b|sed|awk|jq|\\bcat\\b)[\\s\\S]*rules\\.json)";
const re = new RegExp(PATTERN);

function blocked(command: string): boolean {
	return re.test(command);
}

describe("防绕过正则词边界（D3）", () => {
	it("含 catlain 路径的只读 git diff 不误拦（10-12 事故形态）", () => {
		assert.ok(
			!blocked(
				"cd /c/Users/Administrator/.pi/agent/git/github.com/catlain/pi-shepherd && git diff HEAD -- shepherd/rules.json | head -40",
			),
		);
	});

	it("含 catlain 路径的只读 grep 不误拦", () => {
		assert.ok(
			!blocked(
				"cd /c/Users/Administrator/.pi/agent/git/github.com/catlain && grep -rn 'foo' pi-shepherd/rules.json",
			),
		);
	});

	it("node -e require 只读查询不误拦", () => {
		assert.ok(!blocked("node -e \"console.log(require('./rules.json').length)\""));
	});

	it("真 cat 读取仍拦截", () => {
		assert.ok(blocked("cat rules.json"));
		assert.ok(blocked("cd /tmp && cat rules.json | grep secret"));
	});

	it("python json.load/open 仍拦截", () => {
		assert.ok(blocked("python -c \"json.load(open('rules.json'))\""));
	});

	it("sed/awk/jq 改写仍拦截", () => {
		assert.ok(blocked("sed -i 's/a/b/' rules.json"));
		assert.ok(blocked("jq '.[0].enabled = false' rules.json > tmp && mv tmp rules.json"));
	});

	it("write 独立单词仍拦截（writeFileSync 残留由 edit/write 规则覆盖，见文件头注）", () => {
		assert.ok(blocked("node -e \"fs.write('rules.json', ...)\" "));
		assert.ok(!blocked("node -e \"fs.writeFileSync('rules.json', 'x')\""));
	});
});
