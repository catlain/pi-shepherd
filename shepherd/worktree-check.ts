/**
 * Worktree 检测与清理
 * session_start 时自动检测未合并 worktree 并提醒
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isSubagent, isInWorktree } from "./rules.js";

interface UIContext {
	notify?: (msg: string, level?: "error" | "info" | "warning") => void;
}

function git(args: string[], opts: { cwd: string; timeout?: number }): string {
	try {
		return execFileSync("git", args, {
			timeout: opts.timeout ?? 5000,
			stdio: ["pipe", "pipe", "pipe"],
			cwd: opts.cwd,
			encoding: "utf-8",
		}).trim();
	} catch {
		return "";
	}
}

export function checkWorktrees(ctx: UIContext): void {
	if (isSubagent()) return;
	if (isInWorktree()) return;

	try {
		const cwd = process.cwd();
		const branches = git(["branch", "--list", "worktree/*", "--no-color"], { cwd });
		if (!branches) return;

		const branchList = branches.split("\n").map(b => b.replace(/^\s*[+*]\s*/, "").trim()).filter(Boolean);
		if (branchList.length === 0) return;

		const merged: string[] = [];
		const unmerged: string[] = [];

		for (const branch of branchList) {
			const logResult = git(["log", `main..${branch}`, "--oneline"], { cwd, timeout: 3000 });
			if (logResult) {
				unmerged.push(branch);
			} else {
				const verify = git(["rev-parse", "--verify", `${branch}^{commit}`], { cwd, timeout: 2000 });
				if (verify) {
					merged.push(branch);
				}
				// 无 commit 的分支，忽略
			}
		}

		if (merged.length > 0) {
			for (const branch of merged) {
				const name = branch.replace(/^worktree\//, "");
				const wtPath = join(cwd, ".worktrees", name);
				try {
					// 先尝试 git worktree remove
					git(["worktree", "remove", join(".worktrees", name), "--force"], { cwd, timeout: 10000 });
				} catch {
					// fallback: 用 fs.rmSync 而非 shell rm -rf
					if (existsSync(wtPath)) {
						try { rmSync(wtPath, { recursive: true, force: true }); } catch { /* ignore */ }
					}
				}
				git(["branch", "-d", branch], { cwd, timeout: 3000 });
			}
			ctx.notify?.(
				`🧹 shepherd: 自动清理了 ${merged.length} 个已合并 worktree: ${merged.map(b => b.replace('worktree/', '')).join(', ')}`,
				"info",
			);
		}

		if (unmerged.length > 0) {
			const details = unmerged.map(b => {
				const name = b.replace(/^worktree\//, "");
				const wtPath = join(cwd, ".worktrees", name);
				let uncommitted = 0;
				let aheadCount = 0;
				if (existsSync(wtPath)) {
					const statusLines = git(["-C", wtPath, "status", "--short"], { cwd, timeout: 3000 });
					if (statusLines) uncommitted = statusLines.split("\n").length;
				}
				const logLines = git(["log", `main..${b}`, "--oneline"], { cwd, timeout: 3000 });
				if (logLines) aheadCount = logLines.split("\n").length;
				const parts: string[] = [];
				if (aheadCount > 0) parts.push(`${aheadCount} 个未合并提交`);
				if (uncommitted > 0) parts.push(`${uncommitted} 个未提交改动`);
				const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
				return `  - ${name}${summary}`;
			});

			ctx.notify?.(
				`⚠️ shepherd: ${unmerged.length} 个未合并 worktree:\n` +
				details.join("\n") +
				"\n合并: /worktree-merge ｜ 删除: /worktree destroy <名称>",
				"warning",
			);
		}
	} catch {
		// 非 git 仓库，忽略
	}
}
