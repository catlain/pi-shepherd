import path from "node:path";
import { createConfig } from "../vitest.config.base";

export default createConfig({
	alias: {
		"@earendil-works/pi-coding-agent": true,
		"@pi-atelier/shepherd": path.resolve(__dirname, "./shepherd"),
	},
	include: ["tests/**/*.test.ts"],
	test: {
		testTimeout: 10000,
	},
});
