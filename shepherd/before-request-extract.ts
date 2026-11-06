/**
 * before_provider_request 判定输入提取
 *
 * 从 payload.messages 提取两种判定源文本（与 message-end.ts extractAssistantText
 * 同构的 content block 形态——text block 拼接）：
 * - lastUser：尾部往前第一条含 text 的 user 消息（跳过 toolResult-only，真实用户输入）
 * - lastAssistant：尾部往前最近一条含 text 的 assistant 消息（工具调用穿插时的叙述）
 */

/** 判定文本截断上限（before_request 判定对象是单条消息，比 message_end 回合全文短） */
const JUDGE_TEXT_MAX = 4000;

interface TextBlock {
	type: "text";
	text: string;
}

export type PayloadMessage = { role?: string; content?: unknown };

function extractTextBlocks(
	msg: PayloadMessage | null | undefined,
): string {
	if (!msg?.content || !Array.isArray(msg.content)) return "";
	return (msg.content as Array<unknown>)
		.filter(
			(block): block is TextBlock =>
				!!block &&
				typeof block === "object" &&
				(block as any).type === "text" &&
				typeof (block as any).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

/** shepherd 注入消息的前缀标记——lastUser 提取时跳过（防提醒文本自我判定循环） */
export const SHEPHERD_PREFIX = "⚠️ shepherd:";

function isShepherdInjected(text: string): boolean {
	return text.startsWith(SHEPHERD_PREFIX);
}

/**
 * lastUser：从尾部往前第一条含 text block 的 user 消息。
 * 跳过：①仅含 toolResult block 的续请求 user 消息；② shepherd 注入的提醒消息（防自我循环）。
 * 找不到返回 null（该规则本轮跳过）。
 */
export function extractLastUserText(
	messages: PayloadMessage[] | undefined | null,
): string | null {
	if (!messages || !Array.isArray(messages)) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if ((m as any)?.role !== "user") continue;
		const t = extractTextBlocks(m);
		if (t) {
			if (isShepherdInjected(t)) continue; // shepherd 注入消息不算用户输入
			return t.slice(0, JUDGE_TEXT_MAX);
		}
		// toolResult-only 的 user 消息：跳过继续往前找
	}
	return null;
}

/**
 * lastAssistant：从尾部往前最近一条含 text block 的 assistant 消息
 * （工具调用穿插时，叙述与调用的 text block 在同一条 assistant 消息里）。
 */
export function extractLastAssistantText(
	messages: PayloadMessage[] | undefined | null,
): string | null {
	if (!messages || !Array.isArray(messages)) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if ((m as any)?.role !== "assistant") continue;
		const t = extractTextBlocks(m);
		if (t) return t.slice(0, JUDGE_TEXT_MAX);
	}
	return null;
}
