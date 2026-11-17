import type { defineConfig } from "bunup";

const config: Parameters<typeof defineConfig>[0] = {
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	target: "node",
	outDir: "./dist",
	sourcemap: "linked",
	dts: true,
};

export default config;
