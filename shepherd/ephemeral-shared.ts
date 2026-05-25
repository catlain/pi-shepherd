/**
 * Shepherd 临时提示 re-export
 *
 * 缓冲区操作来自 @pi-atelier/shared-utils（单扩展内使用）。
 * 跨扩展传递请用 pi.events.emit("ephemeral:hint")。
 */

export {
	pushHint,
	drainHints,
	peekHints,
	hasHints,
	peekLabels,
} from "@pi-atelier/shared-utils";
