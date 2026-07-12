// Engine-only behaviors that can't live in the shared snapshot corpus
// (v1 reads the same fixtures and would format these differently or crash).

import { assert } from "chai";
import { format_source } from "./engine";

suite("gdscript formatter v2: engine-only behaviors", () => {
	test("lines with unlexable content are preserved verbatim", () => {
		const src = 'func f():\n\tvar ok  =  1\n\tvar bad = "unterminated\n';
		const out = format_source(src);
		// the good line is formatted, the broken one is untouched
		assert.include(out, "\tvar ok = 1\n");
		assert.include(out, '\tvar bad = "unterminated');
	});

	test("stray characters do not crash or reformat their line", () => {
		const src = "var x = 1 ? 2\nvar y  =  3\n";
		const out = format_source(src);
		assert.include(out, "var x = 1 ? 2"); // ? is not GDScript; line kept as-is
		assert.include(out, "var y = 3");
	});

	test("trailing blank lines are deleted (including whitespace-only)", () => {
		assert.strictEqual(format_source("var x = 1\n\n\n  \n"), "var x = 1\n");
	});

	test("interior blank run at EOF boundary", () => {
		assert.strictEqual(format_source("a = 1\n\n\n\n\nb = 2\n"), "a = 1\n\n\nb = 2\n");
	});

	test("no trailing newline is preserved as no trailing newline", () => {
		assert.strictEqual(format_source("var x  =  1"), "var x = 1");
	});

	test("empty and whitespace-only files", () => {
		assert.strictEqual(format_source(""), "");
		assert.strictEqual(format_source("\n\n\n"), "");
		assert.strictEqual(format_source("   \n\t\n"), "");
	});
});
