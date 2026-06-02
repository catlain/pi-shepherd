import { execSync } from "node:child_process";

function parseGitStatus(): { dirty: string[]; untracked: string[] } {
	const result = { dirty: [] as string[], untracked: [] as string[] };
	try {
		const status = execSync("git status --porcelain", {
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
			cwd: process.cwd(),
		})
			.toString()
			.trim();
		if (!status) return result;
		for (const line of status.split("\n")) {
			if (!line) continue;
			if (line.startsWith("??")) {
				result.untracked.push(line);
			} else {
				result.dirty.push(line);
			}
		}
	} catch {
		/* not a git repo or git not available */
	}
	return result;
}

/** 检测 git 工作区是否有已跟踪文件的未提交改动（M/A/D/R） */
export function isGitDirty(): boolean {
	return parseGitStatus().dirty.length > 0;
}

/** 检测 git 工作区是否有未跟踪文件（??） */
export function hasGitUntracked(): boolean {
	return parseGitStatus().untracked.length > 0;
}

/** 检测 git 工作区是否有已跟踪改动或未跟踪文件 */
export function isGitDirtyOrUntracked(): boolean {
	const { dirty, untracked } = parseGitStatus();
	return dirty.length > 0 || untracked.length > 0;
}

/** 向后兼容：原 hasGitUncommittedChanges 只看已跟踪文件 */
export function hasGitUncommittedChanges(): boolean {
	return isGitDirty();
}

/** 当前是否在 worktree 中 */
export function isInWorktree(): boolean {
	try {
		const cwd = process.cwd();
		if (/\/\.worktrees\/[^/]+/.test(cwd)) return true;
		const gitDir = execSync("git rev-parse --git-dir", {
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		})
			.toString()
			.trim();
		return gitDir !== ".git";
	} catch {
		return false;
	}
}
