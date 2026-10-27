import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";
import fs from "node:fs";
import path from "node:path";

const prod = process.argv[2] === "production";
const PLUGIN_ID = JSON.parse(fs.readFileSync("manifest.json", "utf8")).id;

// Optional: path to a vault, read from OBSIDIAN_VAULT or a local .vault-path file.
// Build output is copied into <vault>/.obsidian/plugins/<id>.
function vaultPath() {
	if (process.env.OBSIDIAN_VAULT) return process.env.OBSIDIAN_VAULT;
	if (fs.existsSync(".vault-path")) return fs.readFileSync(".vault-path", "utf8").trim();
	return null;
}

const deployPlugin = {
	name: "deploy-to-vault",
	setup(build) {
		build.onEnd((result) => {
			if (result.errors.length) return;
			const vault = vaultPath();
			if (!vault) return;
			const target = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
			fs.mkdirSync(target, { recursive: true });
			for (const f of ["main.js", "manifest.json", "styles.css"]) {
				if (fs.existsSync(f)) fs.copyFileSync(f, path.join(target, f));
			}
			// Touch .hotreload in dev so the Hot Reload plugin (if installed) picks up changes.
			if (!prod) fs.writeFileSync(path.join(target, ".hotreload"), "");
			console.log(`[${PLUGIN_ID}] deployed to ${target}`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
	jsx: "automatic",
	define: { "process.env.NODE_ENV": JSON.stringify(prod ? "production" : "development") },
	plugins: [deployPlugin],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
