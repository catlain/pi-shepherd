/**
 * Shepherd 临时提示 re-export
 *
 * 缓冲区操作来自 @pi-atelier/shared-utils（单扩展内使用）。
 * 空 label 归一化（'' 等价 undefined）由 shared-utils 源头单点保证（v1.2.1 起）。
 * 跨扩展传递请用 pi.events.emit("ephemeral:hint")。
 */

export {
	drainHints,
	hasHints,
	peekHints,
	peekLabels,
	pushHint,
} from "@pi-atelier/shared-utils";
