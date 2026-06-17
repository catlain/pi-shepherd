/**
 * pi SDK 工具事件类型定义
 * 统一 tool_call 和 tool_result 事件的联合类型
 */

import type {
	BashToolCallEvent,
	CustomToolCallEvent,
	EditToolCallEvent,
	GrepToolCallEvent,
	LsToolCallEvent,
	ReadToolCallEvent,
	ToolResultEvent,
	WriteToolCallEvent,
} from "@earendil-works/pi-coding-agent";


/** content block 中的文本块 */
interface ContentBlock {
	type: string;
	text?: string;
}

/** 从 tool_result 事件的 content 中提取纯文本 */
export function extractResultText(event: ToolEvent): string {
	if (!("content" in event)) return "";
	const content = (event as { content?: ContentBlock[] }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("");
}

/** getMatchTargets 接收的事件类型（tool_call 或 tool_result） */
export type ToolEvent =
	| BashToolCallEvent
	| CustomToolCallEvent
	| EditToolCallEvent
	| GrepToolCallEvent
	| LsToolCallEvent
	| ReadToolCallEvent
	| WriteToolCallEvent
	| ToolResultEvent;
