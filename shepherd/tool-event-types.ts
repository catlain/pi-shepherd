/**
 * pi SDK 工具事件类型定义
 * 统一 tool_call 和 tool_result 事件的联合类型
 */

import type {
	BashToolCallEvent,
	BashToolResultEvent,
	CustomToolCallEvent,
	CustomToolResultEvent,
	EditToolCallEvent,
	EditToolResultEvent,
	GrepToolCallEvent,
	GrepToolResultEvent,
	LsToolCallEvent,
	LsToolResultEvent,
	ReadToolCallEvent,
	ReadToolResultEvent,
	WriteToolCallEvent,
	WriteToolResultEvent,
} from "@earendil-works/pi-coding-agent";

/** getMatchTargets 接收的事件类型（tool_call 或 tool_result） */
export type ToolEvent =
	| BashToolCallEvent | BashToolResultEvent
	| CustomToolCallEvent | CustomToolResultEvent
	| EditToolCallEvent | EditToolResultEvent
	| GrepToolCallEvent | GrepToolResultEvent
	| LsToolCallEvent | LsToolResultEvent
	| ReadToolCallEvent | ReadToolResultEvent
	| WriteToolCallEvent | WriteToolResultEvent;
