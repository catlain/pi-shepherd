/**
 * Shepherd 配置接入测试
 * 验证 getEffectiveConfig 对 shepherd section 的读取
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	getEffectiveConfig,
	validateConfigSchema,
	clearProjectSettingsCache,
} from "@pi-atelier/shared-utils";

const TEST_DIR = join(tmpdir(), "pi-shepherd-config-test");

function createProjectSettings(dir: string, content: Record<string, any>) {
	const piDir = join(dir, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "settings.json"), JSON.stringify(content, null, 2));
}

function cleanupDir(dir: string) {
	if (existsSync(dir)) rmSync(dir, { recursive: true });
}

// ── ShepherdConfig schema ──
interface ShepherdConfig {
	enabled: boolean;
	rulesDir: string;
	projectRulesPattern: string;
	maxWarnings: number;
}

const SHEPHERD_DEFAULTS: ShepherdConfig = {
	enabled: true,
	rulesDir: "",
	projectRulesPattern: "shepherd-rules-*.json",
	maxWarnings: 5,
};

describe("shepherd 配置接入", () => {
	beforeEach(() => {
		cleanupDir(TEST_DIR);
		clearProjectSettingsCache();
		mkdirSync(TEST_DIR, { recursive: true });
	});
	afterEach(() => {
		cleanupDir(TEST_DIR);
	});

	it("无项目配置时使用默认值", () => {
		const { config } = getEffectiveConfig("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(config.enabled).toBe(true);
		expect(config.projectRulesPattern).toBe("shepherd-rules-*.json");
		expect(config.maxWarnings).toBe(5);
	});

	it("项目级禁用 shepherd", () => {
		createProjectSettings(TEST_DIR, {
			shepherd: { enabled: false },
		});

		const { config, sources } = getEffectiveConfig("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(config.enabled).toBe(false);
		expect(sources.enabled).toBe("project");
	});

	it("项目级覆盖 maxWarnings", () => {
		createProjectSettings(TEST_DIR, {
			shepherd: { maxWarnings: 10 },
		});

		const { config } = getEffectiveConfig("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(config.maxWarnings).toBe(10);
		expect(config.enabled).toBe(true);
	});

	it("项目级自定义规则文件名模式", () => {
		createProjectSettings(TEST_DIR, {
			shepherd: { projectRulesPattern: "my-rules-*.json" },
		});

		const { config } = getEffectiveConfig("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(config.projectRulesPattern).toBe("my-rules-*.json");
	});

	it("格式校验：enabled 必须是布尔值", () => {
		createProjectSettings(TEST_DIR, {
			shepherd: { enabled: "yes" },
		});

		const errors = validateConfigSchema("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].key).toBe("enabled");
		expect(errors[0].expectedType).toBe("boolean");
		expect(errors[0].actualType).toBe("string");
	});

	it("格式校验：maxWarnings 必须是数字", () => {
		createProjectSettings(TEST_DIR, {
			shepherd: { maxWarnings: "10" },
		});

		const errors = validateConfigSchema("shepherd", SHEPHERD_DEFAULTS, TEST_DIR);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].key).toBe("maxWarnings");
	});
});
