// Stress the GDScript lexer + formatter v2 engine AND the tscn parser over
// external corpora.
//
//   npm run test:corpus -- <dir> [<dir> ...]
//
// For every .gd file found recursively it asserts:
//   1. lexer round-trip: trivia+token concatenation is byte-identical
//   2. tokenize() and format_source() never throw
//   3. formatter idempotency: format(format(x)) == format(x)
// and reports files containing ERROR tokens, split into expected (inside an
// errors/ directory — engine-repo negative tests) and unexpected.
//
// For every .tscn/.tres file it asserts interpret_scene() never throws and
// reports parser warnings (skipped/unparseable constructs) — a warning on a
// file Godot itself wrote means the scene format grew and src/tscn/ needs
// updating (see lode/gdscript/grammar-watch.md).
//
// Good corpora: your own game projects, and the Godot engine repo's
// modules/gdscript/tests/scripts (check out several stable tags as worktrees).

import * as fs from "node:fs";
import * as path from "node:path";
import { tokenize } from "../src/gdscript/lexer/lexer";
import { TokenKind } from "../src/gdscript/lexer/tokens";
import { format_source } from "../src/gdscript/formatter/engine";
import { interpret_scene } from "../src/tscn/scene";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
	console.error("usage: npm run test:corpus -- <dir> [<dir> ...]");
	process.exit(2);
}

const files: string[] = [];
const sceneFiles: string[] = [];
function walk(dir: string) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
		} else if (entry.name.endsWith(".gd")) {
			files.push(full);
		} else if (entry.name.endsWith(".tscn") || entry.name.endsWith(".tres")) {
			sceneFiles.push(full);
		}
	}
}
for (const dir of dirs) {
	walk(dir);
}

let ok = 0;
let errExpected = 0;
const mismatches: string[] = [];
const throws: string[] = [];
const notIdempotent: string[] = [];
const errUnexpected: string[] = [];
const t0 = Date.now();

for (const file of files) {
	const src = fs.readFileSync(file, "utf8");
	try {
		const tokens = tokenize(src);
		let rebuilt = "";
		for (const t of tokens) {
			for (const tr of t.leading) rebuilt += tr.text;
			rebuilt += t.text;
			for (const tr of t.trailing) rebuilt += tr.text;
		}
		if (rebuilt !== src) {
			mismatches.push(file);
			continue;
		}
		if (tokens.some((t) => t.kind === TokenKind.Error)) {
			if (/[/\\]errors?[/\\]/.test(file)) {
				errExpected++;
			} else {
				errUnexpected.push(file);
			}
		}
		const once = format_source(src);
		if (format_source(once) !== once) {
			notIdempotent.push(file);
		}
		ok++;
	} catch (e) {
		throws.push(`${file} :: ${(e as Error).message}`);
	}
}

let sceneOk = 0;
const sceneThrows: string[] = [];
const sceneWarnings: string[] = [];
for (const file of sceneFiles) {
	try {
		const scene = interpret_scene(fs.readFileSync(file, "utf8"));
		for (const w of scene.warnings) {
			sceneWarnings.push(`${file}: ${w}`);
		}
		sceneOk++;
	} catch (e) {
		sceneThrows.push(`${file} :: ${(e as Error).message}`);
	}
}

console.log(`gd files: ${files.length}, ok: ${ok}, time: ${Date.now() - t0}ms`);
console.log(`round-trip mismatches: ${mismatches.length}, throws: ${throws.length}`);
console.log(`idempotency violations: ${notIdempotent.length}`);
console.log(`ERROR tokens: ${errExpected} in error-dirs (expected), ${errUnexpected.length} elsewhere`);
console.log(
	`scene files: ${sceneFiles.length}, ok: ${sceneOk}, throws: ${sceneThrows.length}, warnings: ${sceneWarnings.length}`,
);
const bad = [...mismatches, ...throws, ...notIdempotent, ...errUnexpected, ...sceneThrows, ...sceneWarnings];
for (const b of bad.slice(0, 20)) {
	console.log("  !!", b);
}
process.exit(bad.length > 0 ? 1 : 0);
