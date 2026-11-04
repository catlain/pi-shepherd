// llmJudge prompt 评估脚本：对给定语料跑真实 LLM 判断，输出判定矩阵
// 用法: node .pi/tmp/llmjudge-cases.mjs <语料.json> [prompt覆盖文本]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const compat = require("C:/Users/Administrator/.pi/agent/git/github.com/catlain/_sdk-link/node_modules/@earendil-works/pi-ai/dist/compat.js");

const casesFile = process.argv[2] ?? ".pi/tmp/llmjudge-cases.json";
const promptOverride = process.argv[3];
const spec = JSON.parse(readFileSync(casesFile, "utf8"));
const judgePrompt = promptOverride ?? spec.prompt_under_test;

const SYSTEM = "你是规则引擎的语义判断器。用户会给你一个判断问题和一段文本，你只回答“是”或“否”，不要任何其他内容。";

function parseYesNo(out) {
	const first = (out ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
	const m = first.match(/^\W*(是|否)/);
	return m ? m[1] : null;
}

async function main() {
	const model = compat.getModel("zai", "glm-5.3");
	const apiKey = process.env.ZAI_API_KEY;
	let pass = 0, fail = 0;
	console.log(`prompt（${promptOverride ? "覆盖版" : "基线"}）：${judgePrompt.slice(0, 40)}…\n`);
	for (const c of spec.cases) {
		const user = judgePrompt + "\n\n待判断文本：\n" + c.text;
		let verdict = "ERR", raw = "";
		try {
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 30000);
			const result = await compat.completeSimple(
				model,
				{ systemPrompt: SYSTEM, messages: [{ role: "user", content: user }] },
				{ apiKey, signal: ac.signal },
			);
			clearTimeout(timer);
			raw = (result.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
			verdict = parseYesNo(raw) ?? "PARSE_FAIL";
		} catch (e) {
			verdict = "ERR:" + String(e?.message ?? e).slice(0, 60);
		}
		const ok = c.expect.split("|").includes(verdict);
		ok ? pass++ : fail++;
		console.log(`${ok ? "✓" : "✗"} [${c.id}] 预期=${c.expect} 判定=${verdict}  ${c.note}`);
		if (!ok) console.log(`    原始回复: ${JSON.stringify(raw.slice(0, 80))}`);
	}
	console.log(`\n结果: ${pass} 通过 / ${fail} 失败（共 ${spec.cases.length}）`);
	process.exit(fail === 0 ? 0 : 1);
}
main();
