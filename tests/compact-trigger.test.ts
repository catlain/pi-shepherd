/**
 * compact-trigger 单元测试 — 纯函数分支 + IO 读改写路径（mock shared-utils）。
 *
 * 覆盖：换算正确性 / 区间边界拒绝 / 嵌套合并保留性 / 删除保留其他模型 /
 * 无 override 幂等不写盘 / describeTrigger 两种形态。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSettingsValue = vi.fn();
const mockPatchBackup = vi
	.fn()
	.mockReturnValue({ config: {}, errors: [], backupPath: undefined });
vi.mock("@pi-atelier/shared-utils", () => ({
	getSettingsValue: (...a: unknown[]) => mockGetSettingsValue(...(a as [])),
	patchSettingsSectionWithBackup: (...a: unknown[]) =>
		mockPatchBackup(...(a as [])),
	SETTINGS_PATH: "/mock/settings.json",
}));

import {
	applyTriggerSet,
	buildTriggerConversion,
	type CompactionSection,
	describeTrigger,
	mergeOverrideIntoSection,
	modelKeyOf,
	removeOverrideFromSection,
	removeTriggerOverride,
	type TriggerModelShape,
	triggerRange,
} from "../shepherd/compact-trigger";

const MODEL: TriggerModelShape = {
	provider: "zai",
	id: "glm-5.3",
	contextWindow: 1000000,
};

function sectionWith(
	overrides?: CompactionSection["modelOverrides"],
): CompactionSection {
	return { enabled: true, modelOverrides: overrides };
}

beforeEach(() => {
	mockGetSettingsValue.mockReset().mockReturnValue({});
	mockPatchBackup.mockClear();
});

describe("modelKeyOf / triggerRange", () => {
	it("构造 provider/id 格式 key", () => {
		expect(modelKeyOf(MODEL)).toBe("zai/glm-5.3");
	});

	it("区间 = [30000, 窗口-16384]", () => {
		expect(triggerRange(1000000)).toEqual({ min: 30000, max: 983616 });
	});
});

describe("buildTriggerConversion", () => {
	it("1M 窗口 trigger=200000 → reserveTokens=800000", () => {
		expect(buildTriggerConversion(MODEL, 200000)).toEqual({
			ok: true,
			modelKey: "zai/glm-5.3",
			triggerTokens: 200000,
			reserveTokens: 800000,
		});
	});

	it("边界值恰好通过（min 与 max）", () => {
		expect(buildTriggerConversion(MODEL, 30000).ok).toBe(true);
		expect(buildTriggerConversion(MODEL, 983616).ok).toBe(true);
	});

	it("低于下限拒绝（防压缩循环）", () => {
		const r = buildTriggerConversion(MODEL, 29999);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("29999");
	});

	it("高于窗口-16384 拒绝（保摘要余量）", () => {
		expect(buildTriggerConversion(MODEL, 983617).ok).toBe(false);
	});

	it("非整数 / 负数拒绝", () => {
		expect(buildTriggerConversion(MODEL, 200000.5).ok).toBe(false);
		expect(buildTriggerConversion(MODEL, -1).ok).toBe(false);
	});

	it("小窗口模型区间同步收窄", () => {
		const small: TriggerModelShape = {
			provider: "x",
			id: "y",
			contextWindow: 200000,
		};
		expect(triggerRange(200000).max).toBe(183616);
		expect(buildTriggerConversion(small, 190000).ok).toBe(false);
	});
});

describe("mergeOverrideIntoSection", () => {
	it("合并保留其他模型 override", () => {
		const s = sectionWith({ "other/model": { reserveTokens: 100 } });
		const next = mergeOverrideIntoSection(s, "zai/glm-5.3", 800000);
		expect(next.modelOverrides).toEqual({
			"other/model": { reserveTokens: 100 },
			"zai/glm-5.3": { reserveTokens: 800000 },
		});
		// 原对象不可变
		expect(s.modelOverrides?.["zai/glm-5.3"]).toBeUndefined();
	});

	it("保留该模型既有 keepRecentTokens", () => {
		const s = sectionWith({ "zai/glm-5.3": { keepRecentTokens: 30000 } });
		const next = mergeOverrideIntoSection(s, "zai/glm-5.3", 800000);
		expect(next.modelOverrides?.["zai/glm-5.3"]).toEqual({
			keepRecentTokens: 30000,
			reserveTokens: 800000,
		});
	});

	it("空 section 安全初始化 modelOverrides", () => {
		const next = mergeOverrideIntoSection({}, "zai/glm-5.3", 800000);
		expect(next.modelOverrides).toEqual({
			"zai/glm-5.3": { reserveTokens: 800000 },
		});
	});
});

describe("removeOverrideFromSection", () => {
	it("删除目标 key 保留其他模型", () => {
		const s = sectionWith({
			"zai/glm-5.3": { reserveTokens: 800000 },
			"other/model": { reserveTokens: 100 },
		});
		const { next, changed } = removeOverrideFromSection(s, "zai/glm-5.3");
		expect(changed).toBe(true);
		expect(next.modelOverrides).toEqual({
			"other/model": { reserveTokens: 100 },
		});
	});

	it("无该 key 时 changed=false 原样返回", () => {
		const s = sectionWith({ "other/model": { reserveTokens: 100 } });
		const r = removeOverrideFromSection(s, "zai/glm-5.3");
		expect(r.changed).toBe(false);
		expect(r.next).toBe(s);
	});

	it("section 无 modelOverrides 时安全", () => {
		expect(removeOverrideFromSection({}, "zai/glm-5.3").changed).toBe(false);
	});
});

describe("describeTrigger", () => {
	it("有 override：显示触发点 + reserveTokens + 窗口", () => {
		const s = sectionWith({ "zai/glm-5.3": { reserveTokens: 800000 } });
		const text = describeTrigger(MODEL, s);
		expect(text).toContain("200000");
		expect(text).toContain("reserveTokens=800000");
		expect(text).toContain("1000000");
	});

	it("无 override：显示默认行为", () => {
		const text = describeTrigger(MODEL, {});
		expect(text).toContain("默认");
		expect(text).toContain("16384");
	});
});

describe("IO：applyTriggerSet / removeTriggerOverride（读-改-整体写回）", () => {
	it("set：读盘合并后只写 modelOverrides 字段", () => {
		mockGetSettingsValue.mockReturnValue(
			sectionWith({ "other/model": { reserveTokens: 100 } }),
		);
		const r = applyTriggerSet(MODEL, 200000);
		expect(r.ok).toBe(true);
		expect(mockPatchBackup).toHaveBeenCalledWith(
			"compaction",
			{
				modelOverrides: {
					"other/model": { reserveTokens: 100 },
					"zai/glm-5.3": { reserveTokens: 800000 },
				},
			},
			{},
			{ settingsPath: "/mock/settings.json" },
		);
	});

	it("set 区间外：不写盘", () => {
		const r = applyTriggerSet(MODEL, 100);
		expect(r.ok).toBe(false);
		expect(mockPatchBackup).not.toHaveBeenCalled();
	});

	it("remove：存在则删并写盘", () => {
		mockGetSettingsValue.mockReturnValue(
			sectionWith({ "zai/glm-5.3": { reserveTokens: 800000 } }),
		);
		const r = removeTriggerOverride(MODEL);
		expect(r.changed).toBe(true);
		expect(mockPatchBackup).toHaveBeenCalledWith(
			"compaction",
			{ modelOverrides: {} },
			{},
			{ settingsPath: "/mock/settings.json" },
		);
	});

	it("remove：无条目幂等不写盘", () => {
		mockGetSettingsValue.mockReturnValue({});
		const r = removeTriggerOverride(MODEL);
		expect(r.changed).toBe(false);
		expect(mockPatchBackup).not.toHaveBeenCalled();
	});
});
