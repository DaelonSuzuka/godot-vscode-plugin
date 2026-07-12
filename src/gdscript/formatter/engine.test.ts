// Engine-only behaviors that can't live in the shared snapshot corpus
// (v1 reads the same fixtures and would format these differently or crash).

import { assert } from "chai";
import { format_source, normalize_options } from "./engine";

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

	test("CRLF documents stay CRLF, including rebuilt lines", () => {
		const src = "var  a  =  1\r\nfunc f():\r\n\tpass\r\n";
		const out = format_source(src);
		assert.strictEqual(out, "var a = 1\r\nfunc f():\r\n\tpass\r\n");
		assert.strictEqual(format_source(out), out);
	});
});

suite("gdscript formatter v2: options normalization", () => {
	test("maxEmptyLines clamps, rounds, and defaults", () => {
		assert.strictEqual(normalize_options({ maxEmptyLines: 3.7 }).maxEmptyLines, 4);
		assert.strictEqual(normalize_options({ maxEmptyLines: -5 }).maxEmptyLines, 0);
		assert.strictEqual(normalize_options({ maxEmptyLines: "two" }).maxEmptyLines, 2);
		assert.strictEqual(normalize_options({}).maxEmptyLines, 2);
		assert.strictEqual(normalize_options({ maxEmptyLines: Number.NaN }).maxEmptyLines, 2);
	});

	test("spacesBeforeEndOfLineComment: settings string enum", () => {
		assert.strictEqual(normalize_options({ spacesBeforeEndOfLineComment: "1" }).spacesBeforeEndOfLineComment, 1);
		assert.strictEqual(normalize_options({ spacesBeforeEndOfLineComment: "2" }).spacesBeforeEndOfLineComment, 2);
		assert.strictEqual(normalize_options({ spacesBeforeEndOfLineComment: 1 }).spacesBeforeEndOfLineComment, 1);
	});

	test("denseFunctionParameters must be literally true", () => {
		assert.isTrue(normalize_options({ denseFunctionParameters: true }).denseFunctionParameters);
		assert.isFalse(normalize_options({ denseFunctionParameters: "yes" }).denseFunctionParameters);
		assert.isFalse(normalize_options({}).denseFunctionParameters);
	});
});

suite("gdscript formatter v2: fixes over v1", () => {
	test("string literals are never corrupted (v1 inserts a space in ',')", () => {
		const src = "var x = value.replace(',', '.')\n";
		assert.strictEqual(format_source(src), src);
	});
});
