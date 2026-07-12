// Plain-node snapshot tests for the v2 formatter engine — no VS Code host.
// Run with: npm run test:unit (picks up out/gdscript/**/*.test.js)
//
// Shares the fixture corpus with the v1 formatter (src/formatter/snapshots/).
// Differences from the v1 runner (formatter.test.ts), all deliberate:
// - fixture lines are preserved RAW (the v1 runner trims every line, which
//   flattens all indentation before testing)
// - malformed CONFIG JSON fails the test instead of silently becoming {}
// - every case additionally asserts idempotency: format(OUT) == OUT

import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { defaultOptions, type FormatterOptions, format_source } from "./engine";

const snapshotsPath = path.resolve(__dirname, "..", "..", "..", "src", "formatter", "snapshots");

const CONFIG_ALL = "# --- CONFIG ALL ---";
const CONFIG = "# --- CONFIG ---";
const IN = "# --- IN ---";
const OUT = "# --- OUT ---";
const END = "# --- END ---";
const MODES = [CONFIG_ALL, CONFIG, IN, OUT, END];

interface TestCase {
	name: string;
	in: string;
	out: string;
	options: FormatterOptions;
	strict: boolean;
}

function build_config(lines: string[], where: string): Record<string, unknown> {
	const text = lines.join("\n").trim();
	if (text === "") {
		return {};
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Error(`malformed CONFIG JSON in ${where}: ${e}`);
	}
}

function parse_test_file(content: string, fileName: string): TestCase[] {
	const tests: TestCase[] = [];
	let defaultConfig: Record<string, unknown> = {};
	let configAllLines: string[] = [];
	let configLines: string[] = [];
	let inLines: string[] = [];
	let outLines: string[] = [];
	let mode = "";

	const flush = () => {
		if (inLines.length === 0) {
			return;
		}
		const merged = {
			...defaultOptions,
			...defaultConfig,
			...build_config(configLines, fileName),
		} as FormatterOptions & { strictTrailingNewlines?: boolean };
		const strict = merged.strictTrailingNewlines === true;
		let input = inLines.join("\n");
		let expected = outLines.length > 0 ? outLines.join("\n") : input;
		if (!strict) {
			input = input.trimEnd();
			expected = expected.trimEnd();
		}
		tests.push({
			name: `${fileName} case ${tests.length + 1}`,
			in: input,
			out: expected,
			options: merged,
			strict,
		});
		configLines = [];
		inLines = [];
		outLines = [];
	};

	for (const rawLine of content.split("\n")) {
		const trimmed = rawLine.trim();
		if (MODES.includes(trimmed)) {
			if (trimmed === CONFIG || trimmed === IN) {
				flush();
			}
			if (configAllLines.length > 0) {
				defaultConfig = build_config(configAllLines, fileName);
				configAllLines = [];
			}
			mode = trimmed;
			continue;
		}
		// content lines are preserved raw — indentation matters
		if (mode === CONFIG_ALL) configAllLines.push(trimmed);
		if (mode === CONFIG) configLines.push(trimmed);
		if (mode === IN) inLines.push(rawLine);
		if (mode === OUT) outLines.push(rawLine);
	}
	flush();
	return tests;
}

function normalize(str: string): string {
	return str.replace(/\r?\n/g, "\n");
}

suite("GDScript Formatter v2 Snapshot Tests", () => {
	const entries = fs
		.readdirSync(snapshotsPath, { withFileTypes: true, recursive: true })
		.filter((f) => f.isFile() && f.name.endsWith(".gd"));

	for (const file of entries) {
		test(`Snapshot: ${file.name}`, () => {
			const content = fs.readFileSync(path.join(snapshotsPath, file.name), "utf8");
			for (const t of parse_test_file(content, file.name)) {
				let actual = normalize(format_source(t.in, t.options));
				if (!t.strict) {
					actual = actual.trimEnd();
				}
				assert.strictEqual(actual, normalize(t.out), t.name);

				// universal idempotency: formatted output must be stable
				let again = normalize(format_source(t.out, t.options));
				if (!t.strict) {
					again = again.trimEnd();
				}
				assert.strictEqual(again, normalize(t.out), `${t.name} (idempotency of OUT)`);
			}
		});
	}
});
