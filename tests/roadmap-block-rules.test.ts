/**
 * roadmap JSON block 规则测试 — edit/write 规则 + bash 基本规则
 *
 * 验证规则 #27-#29 的匹配逻辑：
 * - edit *.roadmap.json → block
 * - write roadmap/roadmap.json → block
 * - bash 含 roadmap.json + 读写操作 → block
 * - bash 多行 Python 脚本跨行匹配 → block（核心修复点）
 */

import { describe, expect, it } from "vitest";
import { isBlocked } from "./helpers/roadmap-test-helpers";

describe("roadmap JSON block 规则", () => {
	describe("edit/write 规则 (#27-#28)", () => {
		it("edit .pi/roadmap/roadmap.json → block", () => {
			expect(
				isBlocked("edit", {
					path: "/home/lain/projects/fuse-bead-puzzle/.pi/roadmap/roadmap.json",
					edits: [],
				}),
			).toBe(true);
		});

		it("edit fuse-bead-puzzle.roadmap.json → block", () => {
			expect(
				isBlocked("edit", {
					path: "/home/lain/.pi/roadmap/fuse-bead-puzzle.roadmap.json",
					edits: [],
				}),
			).toBe(true);
		});

		it("write .pi/roadmap/roadmap.json → block", () => {
			expect(
				isBlocked("write", { path: ".pi/roadmap/roadmap.json", content: "{}" }),
			).toBe(true);
		});

		it("write *.roadmap.json → block", () => {
			expect(
				isBlocked("write", {
					path: "tooling-guardrails.roadmap.json",
					content: "{}",
				}),
			).toBe(true);
		});

		it("edit 其他 .json 文件 → 不拦截", () => {
			expect(isBlocked("edit", { path: "package.json", edits: [] })).toBe(
				false,
			);
		});

		it("edit roadmap.ts → 不拦截", () => {
			expect(isBlocked("edit", { path: "roadmap.ts", edits: [] })).toBe(false);
		});

		it("write roadmap-readme.md → 不拦截", () => {
			expect(
				isBlocked("write", { path: "roadmap-readme.md", content: "# Roadmap" }),
			).toBe(false);
		});
	});

	describe("bash 规则 (#29) — 单行命令", () => {
		it("bash cat roadmap.json → block", () => {
			expect(
				isBlocked("bash", {
					command: "cat /home/lain/.pi/roadmap/fuse-bead-puzzle.roadmap.json",
				}),
			).toBe(true);
		});

		it("bash jq 修改 roadmap.json → block", () => {
			expect(
				isBlocked("bash", {
					command: "jq '.epics[0].status = \"done\"' .pi/roadmap/roadmap.json",
				}),
			).toBe(true);
		});

		it("bash sed 修改 roadmap.json → block", () => {
			expect(
				isBlocked("bash", {
					command: "sed -i 's/todo/done/' .pi/roadmap/roadmap.json",
				}),
			).toBe(true);
		});

		it("bash python 单行 json.dump → block", () => {
			expect(
				isBlocked("bash", {
					command:
						"python3 -c \"import json; json.dump({}, open('roadmap.json','w'))\"",
				}),
			).toBe(true);
		});

		it("bash ls roadmap 目录 → 不拦截", () => {
			expect(isBlocked("bash", { command: "ls /home/lain/.pi/roadmap/" })).toBe(
				false,
			);
		});

		it("bash find 查找 roadmap 文件 → 不拦截", () => {
			expect(
				isBlocked("bash", {
					command: "find /home/lain -name '*roadmap*.json' 2>/dev/null",
				}),
			).toBe(false);
		});

		it("bash 不含 roadmap 的命令 → 不拦截", () => {
			expect(isBlocked("bash", { command: "npm test" })).toBe(false);
		});
	});

	describe("bash 规则 (#29) — 多行 Python 脚本（核心修复点）", () => {
		it("多行 python json.load → block（换行分隔 roadmap.json 和 json.load）", () => {
			const cmd = [
				'python3 -c "',
				"import json",
				"with open('/home/lain/projects/fuse-bead-puzzle/.pi/roadmap/roadmap.json') as f:",
				"    data = json.load(f)",
				"print(data)",
				'"',
			].join("\n");
			expect(isBlocked("bash", { command: cmd })).toBe(true);
		});

		it("多行 python json.dump 写入 → block", () => {
			const cmd = [
				'python3 -c "',
				"import json",
				"with open('tooling-guardrails.roadmap.json', 'w') as f:",
				"    json.dump({'status': 'done'}, f)",
				'"',
			].join("\n");
			expect(isBlocked("bash", { command: cmd })).toBe(true);
		});

		it("多行 python open() 读取 → block", () => {
			const cmd = [
				'python3 -c "',
				"import json",
				"with open('roadmap/roadmap.json') as f:",
				"    content = f.read()",
				"print(content)",
				'"',
			].join("\n");
			expect(isBlocked("bash", { command: cmd })).toBe(true);
		});

		it("多行 python 但不碰 roadmap → 不拦截", () => {
			const cmd = [
				'python3 -c "',
				"import json",
				"with open('package.json') as f:",
				"    data = json.load(f)",
				"print(data['name'])",
				'"',
			].join("\n");
			expect(isBlocked("bash", { command: cmd })).toBe(false);
		});

		it("bash heredoc 写入 roadmap.json → block", () => {
			const cmd = [
				"cat > .pi/roadmap/roadmap.json << 'EOF'",
				'{ "epics": [] }',
				"EOF",
			].join("\n");
			expect(isBlocked("bash", { command: cmd })).toBe(true);
		});
	});
});
