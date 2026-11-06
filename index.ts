/**
 * Shepherd — 通用 Hook 规则引擎
 *
 * 规则驱动的事件 hook，支持多种动作：
 *   - tool_call:  工具调用前（可 block 拦截 / notify 提醒 / rewrite 重写）
 *   - tool_result: 工具执行后（可 notify 提醒 / steer 向 LLM 注入 + 行数检查）
 *   - agent_end: AI 正常完成时（可 notify 提醒，支持 stopReason 过滤）
 *   - session_shutdown: 会话结束时（可 notify 提醒）
 *
 * steer/notify 提示通过 before_provider_request 临时注入到 LLM payload，
 * 不写入 session 历史，不占用后续上下文。
 *
 * 规则配置文件:
 *   全局: <扩展包目录>/rules.json（即本包根目录，随安装方式而定：git 安装在 ~/.pi/agent/git/...，npm 安装在 ~/.pi/agent/npm/node_modules/...）
 *   项目级: <cwd>/.pi/extensions/shepherd-rules-*.json（自动扫描，叠加加载）
 *
 * 修改规则文件后 /reload 即可生效，无需重启 pi。
 *
 * 本文件是装配壳：各 hook 族已拆分至 shepherd/ 下
 * （hint-injector / agent-hooks / tool-hooks / message-end / compaction 等），
 * 此处仅做配置读取与注册编排。
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = __dirname;

import { getEffectiveConfig } from "@pi-atelier/shared-utils";
import {
	checkWorktrees,
	DEFAULT_CONTEXT_RESTORE,
	registerCompactConfigCommand,
	registerMessageEnd,
	registerSessionCompact,
	registerToolCall,
	registerToolResult,
	StateTracker,
	type ContextRestoreConfig,
	type ToolState,
} from "./shepherd";
// 直 import（不经 barrel）：agent-hooks/hint-injector/before-request 携模块级状态，
// 绕过 mock registry 缓存使 resetModules 每用例拿到干净实例
// （barrel 被 partial mock 时 actual 是首次 factory 的固定实例，
// 其模块级状态（_aborted/_agentEndFired/_judgeCache）跨用例泄漏）
import { registerAgentHooks } from "./shepherd/agent-hooks";
import { registerBeforeRequestRules, clearJudgeCache } from "./shepherd/before-request";
import { registerHintInjector } from "./shepherd/hint-injector";
import { registerRulesEditorTool } from "./shepherd/rules-tool";

/** 跨 hook 共享的工具状态 */
const _toolState: ToolState = {
	hasEdits: false,
	tracker: new StateTracker(),
	cachedTools: null,
};

export default function shepherdExtension(pi: ExtensionAPI) {
	// ── 读取配置（三层合并：defaults → 全局 settings → 项目 settings）──
	const { config: shepherdConfig } = getEffectiveConfig<{
		projectRulesPattern: string;
		maxWarnings: number;
		contextRestore: ContextRestoreConfig;
	}>(
		"shepherd",
		{
			projectRulesPattern: "shepherd-rules-",
			maxWarnings: 5,
			contextRestore: DEFAULT_CONTEXT_RESTORE,
		},
		process.cwd(),
	);

	// ── session_start：worktree 检查 + 判定缓存清空 ─────────────
	pi.on("session_start", async (_event, ctx) => {
		checkWorktrees(ctx.ui);
		clearJudgeCache(); // before_request 判定缓存：会话级生命周期，新会话重新判定
	});

	// ── 各 hook 族注册 ──────────────────────────────────────────
	const _rulesOpts = {
		projectRulesPattern: shepherdConfig.projectRulesPattern,
	};

	registerHintInjector(pi);
	registerAgentHooks(pi, {
		rulesDir: RULES_DIR,
		rulesOpts: _rulesOpts,
		toolState: _toolState,
	});
	registerToolCall(pi, _toolState, RULES_DIR, _rulesOpts);
	registerToolResult(pi, _toolState, RULES_DIR, _rulesOpts);
	registerMessageEnd(pi, _toolState, RULES_DIR, _rulesOpts);
	registerBeforeRequestRules(pi, _toolState, RULES_DIR, _rulesOpts);
	registerSessionCompact(
		pi,
		_toolState,
		RULES_DIR,
		_rulesOpts,
		shepherdConfig.contextRestore,
	);
	// /compact-config：contextRestore 配置命令（对照 /distill-config 生态模式）
	registerCompactConfigCommand(pi);

	// ── shepherd_rules 工具：规则文件安全编辑 ───────────────────
	registerRulesEditorTool(pi, RULES_DIR, process.cwd());
}
