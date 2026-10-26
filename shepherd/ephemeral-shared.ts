/**
 * Shepherd 临时提示 re-export
 *
 * 缓冲区操作来自 @pi-atelier/shared-utils（单扩展内使用）。
 * 跨扩展传递请用 pi.events.emit("ephemeral:hint")。
 */

import { pushHint as _pushSharedHint } from "@pi-atelier/shared-utils";

export {
	drainHints,
	hasHints,
	peekHints,
	peekLabels,
} from "@pi-atelier/shared-utils";

/** 包装：空 label 归一化为 undefined —— shared-utils 1.1+ 为 drainHintsWithLabels
 *  配对采用占位式存储（'' 也会被 push），此处保住包级契约“空 label 等价无 label”。 */
export function pushHint(hint: string, label?: string): void {
	_pushSharedHint(hint, label || undefined);
}
