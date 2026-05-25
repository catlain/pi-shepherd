/**
 * 文件行数检查
 * edit/write 后自动检测文件行数，超阈值时注入 ephemeral 提醒
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { pushWarning } from "./ephemeral.js";

// ── 代码文件阈值 ─────────────────────────────────────────────
const LINE_WARN = 200;
const LINE_MUST = 300;
const LINE_BAN = 500;

// ── 记忆文件阈值 ─────────────────────────────────────────────
const MEMORY_LINE_LIMIT = 200;

const CHECKED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".py", ".rs", ".go"]);

/** 判断路径是否为记忆文件（memory/ 或 .pi/memory/ 下的 .md，排除索引文件 MEMORY.md） */
function isMemoryFile(filePath: string): boolean {
	if (!filePath.endsWith(".md")) return false;
	const name = path.basename(filePath);
	if (name === "MEMORY.md") return false;
	const normalized = filePath.replace(/\\/g, "/");
	return /\/memory\//.test(normalized);
}

export function checkLineCount(
	filePath: string,
): void {
	const ext = path.extname(filePath);

	// 记忆文件检查
	if (isMemoryFile(filePath)) {
		checkMemoryFile(filePath);
		return;
	}

	// 代码文件检查
	if (!CHECKED_EXTENSIONS.has(ext)) return;

	let lines: number;
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		lines = content.split("\n").length;
	} catch {
		return;
	}

	const name = path.basename(filePath);

	if (lines >= LINE_BAN) {
		pushWarning(
			`❌ 严禁: ${name} 已有 ${lines} 行（阈值 ${LINE_BAN} 行）。\n` +
			`拆分建议：提取公共函数/工具类到独立文件，目标每个文件 ≤ 200 行。`,
		);
	} else if (lines >= LINE_MUST) {
		pushWarning(
			`🔴 必须拆分: ${name} 已有 ${lines} 行（阈值 ${LINE_MUST} 行）。\n` +
			`拆分建议：提取公共函数/工具类到独立文件，目标每个文件 ≤ 200 行。`,
		);
	} else if (lines >= LINE_WARN) {
		pushWarning(
			`⚠️ 应主动检查: ${name} 已有 ${lines} 行（阈值 ${LINE_WARN} 行）。\n` +
			`拆分建议：提取公共函数/工具类到独立文件，目标每个文件 ≤ 200 行。`,
		);
	}
}

/** 记忆文件行数检查：超过 200 行必须拆分 */
function checkMemoryFile(filePath: string): void {
	let lines: number;
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		lines = content.split("\n").length;
	} catch {
		return;
	}

	if (lines >= MEMORY_LINE_LIMIT) {
		const name = path.basename(filePath);
		pushWarning(
			`📝 记忆文件过长: ${name} 已有 ${lines} 行（上限 ${MEMORY_LINE_LIMIT} 行）。\n` +
			`必须拆分：每个记忆文件一个主题，拆分后用 memory_update 或手动更新 MEMORY.md 索引。`,
		);
	}
}
