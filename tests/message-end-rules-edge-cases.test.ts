/**
 * message_end 规则边缘情况测试
 *
 * 验证当前项目配置的两条 message_end 规则：
 * 1. 归因猜测提醒（notify）— 宽匹配：含'可能'
 * 2. 工具链猜测拦截（steer）— 精准匹配工具链关键词
 *
 * 测试各种边缘场景，确保正则匹配准确、误报可控。
 */

import { describe, expect, it } from "vitest";

// ── 实际规则的正则（从 shepherd-rules.json 复制）──

const RULE_ATTRIBUTION = /可能/;
const RULE_TOOLCHAIN =
	/(可能|应该|估计).{0,30}(缓存|jiti|vitest|proxy|模块解析|工具链)/;

// ── 辅助 ──

function matchAttribution(text: string) {
	return RULE_ATTRIBUTION.test(text);
}
function matchToolchain(text: string) {
	return RULE_TOOLCHAIN.test(text);
}

// ── 测试 ──

describe("message_end 规则边缘情况", () => {
	describe("规则 1：归因猜测提醒", () => {
		// ✅ 应该匹配（宽匹配：含'可能'即触发）
		it("匹配：可能是缓存导致的问题", () => {
			expect(matchAttribution("这个错误可能是缓存导致的")).toBe(true);
		});

		it("匹配：可能截图是黑的", () => {
			expect(matchAttribution("可能截图是黑的（渲染管线还没完成就截了）")).toBe(
				true,
			);
		});

		it("匹配：默认视口可能只有几百像素高", () => {
			expect(matchAttribution("默认视口可能只有几百像素高")).toBe(true);
		});

		it("匹配：测试文件可能被筛选掉了", () => {
			expect(matchAttribution("测试文件可能被筛选掉了")).toBe(true);
		});

		it("匹配：问题可能出在 FixedVertical", () => {
			expect(matchAttribution("问题可能出在 FixedVertical + Projection")).toBe(
				true,
			);
		});

		it("匹配：可能是 Startup 阶段", () => {
			expect(matchAttribution("问题可能是 Startup 阶段的系统执行顺序")).toBe(
				true,
			);
		});

		it("匹配：可能是死循环", () => {
			expect(matchAttribution("可能是 test_interaction.rs 里有死循环")).toBe(
				true,
			);
		});

		it("匹配：可能被遮挡了", () => {
			expect(matchAttribution("游戏窗口可能被遮挡了")).toBe(true);
		});

		// ❌ 不应匹配
		it("不匹配：纯分析无可能", () => {
			expect(
				matchAttribution("根据日志可以看到这个函数在处理空值时没有做检查"),
			).toBe(false);
		});

		it("不匹配：明确陈述事实", () => {
			expect(
				matchAttribution("测试失败了，错误信息是 expected true received false"),
			).toBe(false);
		});
	});

	describe("规则 2：工具链猜测拦截", () => {
		// ✅ 应该匹配
		it("匹配：可能是缓存问题", () => {
			expect(matchToolchain("可能是缓存问题")).toBe(true);
		});

		it("匹配：应该是 vitest proxy 导致的", () => {
			expect(matchToolchain("应该是 vitest proxy 导致的")).toBe(true);
		});

		it("匹配：估计是 jiti 缓存没刷新", () => {
			expect(matchToolchain("估计是 jiti 缓存没刷新")).toBe(true);
		});

		it("匹配：可能是模块解析出了问题", () => {
			expect(matchToolchain("可能是模块解析出了问题")).toBe(true);
		});

		it("匹配：应该是工具链的 bug", () => {
			expect(matchToolchain("应该是工具链的 bug")).toBe(true);
		});

		it("匹配：可能是 proxy 丢失了 mock", () => {
			expect(matchToolchain("可能是 proxy 丢失了 mock")).toBe(true);
		});

		// ❌ 不应匹配
		it("不匹配：正常的代码缓存（非工具链语境）", () => {
			expect(matchToolchain("这里用了一个 LRU 缓存来优化性能")).toBe(false);
		});

		it("不匹配：工具名中包含关键词但不是猜测", () => {
			expect(matchToolchain("运行 npx vitest run --reporter=verbose")).toBe(
				false,
			);
		});

		it("不匹配：中间超过 30 字符", () => {
			const text =
				"可能是某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某缓存";
			// 计算中间距离
			const mid = text.length - 2 - 2; // 去掉"可能"和"缓存"
			expect(mid > 30).toBe(true);
			expect(matchToolchain(text)).toBe(false);
		});

		it("不匹配：没有触发词", () => {
			expect(matchToolchain("缓存已经清除了")).toBe(false);
		});

		it("不匹配：英文语境中的 vitest", () => {
			expect(matchToolchain("The vitest config looks correct")).toBe(false);
		});
	});

	describe("两条规则交叉场景", () => {
		it("同时触发两条：'可能是缓存导致的问题'", () => {
			const text = "可能是缓存导致的问题";
			expect(matchAttribution(text)).toBe(true);
			expect(matchToolchain(text)).toBe(true);
		});

		it("只触发规则1：'可能视口太小'", () => {
			const text = "可能视口太小";
			expect(matchAttribution(text)).toBe(true);
			expect(matchToolchain(text)).toBe(false);
		});

		it("只触发规则2：'应该是 jiti 的问题'", () => {
			const text = "应该是 jiti 的问题";
			expect(matchAttribution(text)).toBe(false); // 没有"可能"
			expect(matchToolchain(text)).toBe(true);
		});

		it("都不触发：正常的分析建议", () => {
			const text = "根据日志可以看到错误发生在第 42 行，我来检查一下代码逻辑。";
			expect(matchAttribution(text)).toBe(false);
			expect(matchToolchain(text)).toBe(false);
		});

		it("都不触发：明确陈述事实", () => {
			const text =
				"测试失败了，错误信息是 'expected true, received false'。我来看看断言条件。";
			expect(matchAttribution(text)).toBe(false);
			expect(matchToolchain(text)).toBe(false);
		});
	});
});
