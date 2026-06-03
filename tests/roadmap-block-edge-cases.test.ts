/**
 * roadmap JSON block 规则测试 — bash 边缘情况
 *
 * 验证规则 #29 在各种边界条件下的行为：
 * - awk/cat 单行操作 → block
 * - echo/grep/ls/git/diff 不碰文件 → 不拦截
 */

import { describe, expect, it } from "vitest";
import { isBlocked } from "./helpers/roadmap-test-helpers";

describe("roadmap JSON block 规则 — bash 边缘情况", () => {
	it("awk 处理 roadmap.json → block", () => {
		expect(
			isBlocked("bash", { command: "awk '{print $1}' roadmap.json" }),
		).toBe(true);
	});

	it("cat roadmap.json（单行）→ block", () => {
		expect(isBlocked("bash", { command: "cat roadmap.json" })).toBe(true);
	});

	it("cat 后跟非 roadmap 的 roadmap.json → block", () => {
		expect(
			isBlocked("bash", {
				command: "cat -n /home/lain/.pi/roadmap/roadmap.json",
			}),
		).toBe(true);
	});

	it("bash echo 不碰 roadmap → 不拦截", () => {
		expect(
			isBlocked("bash", { command: "echo 'roadmap.json is a config file'" }),
		).toBe(false);
	});

	it("bash grep roadmap.json 但不读写文件 → 不拦截", () => {
		expect(
			isBlocked("bash", { command: "grep 'status' .pi/roadmap/roadmap.json" }),
		).toBe(false);
	});

	it("bash 路径含 roadmap 但不含读写 → 不拦截", () => {
		expect(isBlocked("bash", { command: "ls -la .pi/roadmap/" })).toBe(false);
	});

	it("bash git 操作涉及 roadmap → 不拦截", () => {
		expect(
			isBlocked("bash", { command: "git add .pi/roadmap/roadmap.json" }),
		).toBe(false);
	});

	it("bash diff 比较 roadmap → 不拦截", () => {
		expect(
			isBlocked("bash", {
				command: "diff .pi/roadmap/roadmap.json .pi/roadmap/roadmap.json.bak",
			}),
		).toBe(false);
	});
});
