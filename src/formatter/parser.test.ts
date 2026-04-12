import { test, describe } from "node:test";
import assert from "node:assert";
import { parse, parseToString } from "./parser";

describe("Lezer GDScript Parser (MVP)", () => {
	test("parses variable declaration", () => {
		const source = 'var x = 42';
		const tree = parse(source);
		assert.ok(tree);
		assert.strictEqual(tree.children.length, 1);
	});

	test("parses typed variable", () => {
		const source = 'var x: int = 42';
		const tree = parse(source);
		assert.ok(tree);
	});

	test("parses function declaration", () => {
		const source = `func foo(a: int, b: String) -> void {
			var x = 1
		}`;
		const tree = parse(source);
		assert.ok(tree);
	});

	test("parses binary expression", () => {
		const source = 'var x = 1 + 2 * 3';
		const tree = parse(source);
		assert.ok(tree);
	});

	test("handles parse errors gracefully", () => {
		const source = 'var = ';
		const tree = parse(source);
		// Should still produce a tree, even with errors
		assert.ok(tree);
	});
});