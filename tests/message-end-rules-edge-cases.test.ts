/**
 * message_end 规则边缘情况测试
 *
 * 验证当前项目配置的两条 message_end 规则：
 * 1. 归因猜测提醒（notify）
 * 2. 工具链猜测拦截（steer）
 *
 * 测试各种边缘场景，确保正则匹配准确、误报可控。
 */

import { describe, it, expect } from "vitest";

// ── 实际规则的正则（从 shepherd-rules.json 复制）──

const RULE_ATTRIBUTION = /可能是.{0,20}(导致|引起|造成|问题|原因|bug|错误|缓存|权限|版本)/;
const RULE_TOOLCHAIN = /(可能|应该|估计).{0,30}(缓存|jiti|vitest|proxy|模块解析|工具链)/;

// ── 辅助 ──

function matchAttribution(text: string) { return RULE_ATTRIBUTION.test(text); }
function matchToolchain(text: string) { return RULE_TOOLCHAIN.test(text); }

// ── 测试 ──

describe("message_end 规则边缘情况", () => {

	describe("规则 1：归因猜测提醒", () => {

		// ✅ 应该匹配
		it("匹配：可能是缓存导致的问题", () => {
			expect(matchAttribution("这个错误可能是缓存导致的")).toBe(true);
		});

		it("匹配：可能是因为权限问题", () => {
			expect(matchAttribution("可能是因为权限问题")).toBe(true);
		});

		it("匹配：可能是版本不兼容造成的", () => {
			expect(matchAttribution("可能是版本不兼容造成的")).toBe(true);
		});

		it("匹配：可能是 jiti 引起的", () => {
			expect(matchAttribution("可能是 jiti 引起的")).toBe(true);
		});

		it("匹配：可能是代码逻辑bug", () => {
			expect(matchAttribution("可能是代码逻辑bug")).toBe(true);
		});

		it("匹配：中间隔着 15 个字符仍然匹配", () => {
			expect(matchAttribution("可能是一些未知的因素共同导致的原因")).toBe(true);
		});

		it("匹配：可能是运行时错误", () => {
			expect(matchAttribution("可能是运行时错误")).toBe(true);
		});

		// ❌ 不应匹配
		it("不匹配：单独的'可能'无归因", () => {
			expect(matchAttribution("这个方法可能可行")).toBe(false);
		});

		it("不匹配：用户说的'可能'", () => {
			expect(matchAttribution("用户说可能是想表达某个意思")).toBe(false);
		});

		it("不匹配：'可能'和归因词之间超过 20 字符", () => {
			const gap21 = "可能是一个很长很长的描述超出了限制导致";
			// "可能是一个很长很长的描述超出了限制" = 17 字符，< 20，应该匹配
			expect(matchAttribution(gap21)).toBe(true);

			// 真正超过 20 字符
			const gap25 = "可能是abcdefghij一二三四五六七八九十导致";
			// "abcdefghij一二三四五六七八九十" = 20 字符，刚好边界
			expect(matchAttribution(gap25)).toBe(true);

			const gapOver = "可能是abcdefghij一二三四五六七八九十X导致";
			// 超过 20 字符
			expect(matchAttribution(gapOver)).toBe(false);
		});

		it("不匹配：没有'可能是'前缀", () => {
			expect(matchAttribution("这个问题导致了错误")).toBe(false);
		});

		it("不匹配：分析假设的正确用法（问题在可能是前面）", () => {
			// 正则要求 "可能是" 在前、归因词在后
			// "问题可能是" 中"问题"在前面，不匹配
			expect(matchAttribution("问题可能是 A、B、C 其中之一，我先排查 A")).toBe(false);
		});

		it("不匹配：纯分析无归因词", () => {
			expect(matchAttribution("根据日志可以看到这个函数在处理空值时没有做检查")).toBe(false);
		});

		it("不匹配：条件性建议", () => {
			expect(matchAttribution("如果 X 成立的话，可能需要调整配置")).toBe(false);
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
			expect(matchToolchain("运行 npx vitest run --reporter=verbose")).toBe(false);
		});

		it("不匹配：中间超过 30 字符", () => {
			const text = "可能是某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某某缓存";
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

		it("只触发规则1：'可能是权限导致的'", () => {
			const text = "可能是权限导致的";
			expect(matchAttribution(text)).toBe(true);
			expect(matchToolchain(text)).toBe(false);
		});

		it("只触发规则2：'应该是 jiti 的问题'", () => {
			const text = "应该是 jiti 的问题";
			expect(matchAttribution(text)).toBe(false); // 没有"可能是"
			expect(matchToolchain(text)).toBe(true);
		});

		it("都不触发：正常的分析建议", () => {
			const text = "根据日志可以看到错误发生在第 42 行，我来检查一下代码逻辑。";
			expect(matchAttribution(text)).toBe(false);
			expect(matchToolchain(text)).toBe(false);
		});

		it("都不触发：明确陈述事实", () => {
			const text = "测试失败了，错误信息是 'expected true, received false'。我来看看断言条件。";
			expect(matchAttribution(text)).toBe(false);
			expect(matchToolchain(text)).toBe(false);
		});
	});
});
