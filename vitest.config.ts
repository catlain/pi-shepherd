import { defineConfig } from "vitest/config";
import path from "node:path";

const globalNodeModules =
  "/home/lain/.local/share/fnm/node-versions/v22.22.2/installation/lib/node_modules";

export default defineConfig({
	resolve: {
		alias: {
			"@earendil-works/pi-coding-agent": path.resolve(
				globalNodeModules,
				"@earendil-works/pi-coding-agent/dist/index.js",
			),
			"@pi-atelier/shepherd": path.resolve(__dirname, "../packages/shepherd/src/index.ts"),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
		testTimeout: 10000,
	},
});
