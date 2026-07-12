// Plain-node tests for the GDScript union lexer — no VS Code host required.
// Run with: npm run test:lexer

import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { tokenize } from "./lexer";
import { type Token, TokenKind } from "./tokens";

/** Losslessness: trivia + text concatenation reproduces the source exactly. */
function reconstruct(tokens: Token[]): string {
	let out = "";
	for (const t of tokens) {
		for (const tr of t.leading) {
			out += tr.text;
		}
		out += t.text;
		for (const tr of t.trailing) {
			out += tr.text;
		}
	}
	return out;
}

function roundtrip(source: string) {
	assert.strictEqual(reconstruct(tokenize(source)), source);
}

/** significant tokens only (no newline/indent/dedent/eof) */
function sig(source: string): Token[] {
	const structural = new Set([TokenKind.Newline, TokenKind.Indent, TokenKind.Dedent, TokenKind.EOF]);
	return tokenize(source).filter((t) => !structural.has(t.kind));
}

function kinds(source: string): string[] {
	return sig(source).map((t) => t.kind);
}

function texts(source: string): string[] {
	return sig(source).map((t) => t.text);
}

function structure(source: string): string[] {
	// compact structural trace: token texts plus NL / IN / DE markers
	return tokenize(source)
		.map((t) => {
			switch (t.kind) {
				case TokenKind.Newline:
					return "NL";
				case TokenKind.Indent:
					return "IN";
				case TokenKind.Dedent:
					return "DE";
				case TokenKind.EOF:
					return "EOF";
				default:
					return t.text;
			}
		})
		.filter((s) => s.length > 0);
}

suite("gdscript lexer: words and literals", () => {
	test("keywords vs identifiers", () => {
		assert.deepEqual(kinds("var health = true"), ["keyword", "identifier", "operator", "keyword"]);
	});

	test("godot 3 keywords are keywords too", () => {
		for (const kw of ["tool", "export", "onready", "setget", "yield", "puppet"]) {
			assert.strictEqual(sig(kw)[0].kind, TokenKind.Keyword, kw);
		}
	});

	test("annotations are single tokens", () => {
		assert.deepEqual(texts("@export var x"), ["@export", "var", "x"]);
		assert.strictEqual(sig("@export var x")[0].kind, TokenKind.Annotation);
	});

	test("numbers", () => {
		const cases = ["0", "123", "1_000_000", "0xFF_EC", "0b1010", "1.5", ".5", "1.", "1e10", "1e-6", "1.5e+3"];
		for (const n of cases) {
			const tokens = sig(`x = ${n}`);
			assert.strictEqual(tokens[2].kind, TokenKind.Number, n);
			assert.strictEqual(tokens[2].text, n, n);
		}
	});

	test("dot-dot is not a decimal point", () => {
		assert.deepEqual(kinds("[1, ..]"), ["bracket_open", "number", "comma", "dot_dot", "bracket_close"]);
	});

	test("strings: plain, single, triple, raw", () => {
		assert.deepEqual(texts(`x = "hi"`), ["x", "=", '"hi"']);
		assert.deepEqual(texts(`x = 'hi'`), ["x", "=", "'hi'"]);
		assert.deepEqual(texts(`x = """a\nb"""`), ["x", "=", '"""a\nb"""']);
		assert.deepEqual(texts(`x = r"a\\d+"`), ["x", "=", 'r"a\\d+"']);
	});

	test("string escapes do not terminate", () => {
		assert.deepEqual(texts(`x = "a\\"b"`), ["x", "=", '"a\\"b"']);
		assert.deepEqual(texts(`x = r"\\""`), ["x", "=", 'r"\\""']);
	});

	test("literal newlines are legal inside any string (Godot semantics)", () => {
		// even single-quoted, even raw — verified against gdscript_tokenizer.cpp
		// and parser/features/r_strings.gd in Godot's own test suite
		const tokens = sig(`x = "a\nb"\ny = 1`);
		assert.strictEqual(tokens[2].kind, TokenKind.String);
		assert.strictEqual(tokens[2].text, '"a\nb"');
		assert.deepEqual(
			tokens.slice(3).map((t) => t.text),
			["y", "=", "1"],
		);
		roundtrip(`x = "a\nb"\ny = 1`);
	});

	test("unterminated string is an error only at EOF, losslessly", () => {
		const src = `x = "oops\ny = 1`;
		const tokens = sig(src);
		assert.strictEqual(tokens[tokens.length - 1].kind, TokenKind.Error);
		roundtrip(src);
	});

	test("string name and node path literals", () => {
		assert.strictEqual(sig(`&"jump"`)[0].kind, TokenKind.StringName);
		assert.strictEqual(sig(`^"Player/Sprite"`)[0].kind, TokenKind.NodePathString);
		// Godot 3 syntax
		assert.strictEqual(sig(`@"Player/Sprite"`)[0].kind, TokenKind.NodePathString);
	});

	test("dollar node paths are single tokens", () => {
		for (const p of ["$Player", "$Player/Sprite2D", '$"Weird Name"/Child', "$A/%Unique"]) {
			const tokens = sig(`x = ${p}`);
			assert.strictEqual(tokens[2].kind, TokenKind.NodePath, p);
			assert.strictEqual(tokens[2].text, p, p);
		}
	});

	test("percent: unique node vs modulo", () => {
		assert.strictEqual(sig("%Sprite")[0].kind, TokenKind.UniqueNode);
		const mod = sig("a % b");
		assert.strictEqual(mod[1].kind, TokenKind.Operator);
		const dense = sig("a%b");
		assert.strictEqual(dense[1].kind, TokenKind.Operator);
		const inBracket = sig("[%Sprite]");
		assert.strictEqual(inBracket[1].kind, TokenKind.UniqueNode);
		const modAssign = sig("a %= 2");
		assert.strictEqual(modAssign[1].text, "%=");
	});

	test("operators, arrow, infer-assign", () => {
		assert.deepEqual(texts("func f() -> int:"), ["func", "f", "(", ")", "->", "int", ":"]);
		assert.strictEqual(sig("var x := 1")[2].kind, TokenKind.InferAssign);
		assert.deepEqual(texts("a **= 2 << 3"), ["a", "**=", "2", "<<", "3"]);
	});
});

suite("gdscript lexer: structure", () => {
	test("newline/indent/dedent for a simple block", () => {
		assert.deepEqual(structure("func f():\n\tpass\n"), [
			"func",
			"f",
			"(",
			")",
			":",
			"NL",
			"IN",
			"pass",
			"NL",
			"DE",
			"EOF",
		]);
	});

	test("blank and comment-only lines emit no NEWLINE", () => {
		assert.deepEqual(structure("x = 1\n\n# comment\n\ny = 2\n"), ["x", "=", "1", "NL", "y", "=", "2", "NL", "EOF"]);
	});

	test("newlines inside brackets are swallowed", () => {
		assert.deepEqual(structure("f(\n\ta,\n\tb,\n)\n"), ["f", "(", "a", ",", "b", ",", ")", "NL", "EOF"]);
	});

	test("line continuation joins lines", () => {
		assert.deepEqual(structure("x = 1 + \\\n\t2\n"), ["x", "=", "1", "+", "2", "NL", "EOF"]);
	});

	test("continuation survives comment-only lines (Godot GH-89403)", () => {
		const src = "if x == 0 \\\n\t# c1\n\t# c2\n\tand y:\n\tpass\n";
		assert.deepEqual(structure(src), [
			"if",
			"x",
			"==",
			"0",
			"and",
			"y",
			":",
			"NL",
			"IN",
			"pass",
			"NL",
			"DE",
			"EOF",
		]);
		roundtrip(src);
	});

	test("statementStart marks first token of logical lines only", () => {
		const tokens = sig("x = f(\n\ta)\ny = 2\n");
		const starts = tokens.filter((t) => t.statementStart).map((t) => t.text);
		assert.deepEqual(starts, ["x", "y"]);
	});

	test("depths use the outer convention", () => {
		const tokens = sig("f(a[b])");
		const byText = new Map(tokens.map((t) => [t.text, t]));
		assert.strictEqual(byText.get("f")?.parenDepth, 0);
		assert.strictEqual(byText.get("(")?.parenDepth, 0);
		assert.strictEqual(byText.get("a")?.parenDepth, 1);
		assert.strictEqual(byText.get("[")?.bracketDepth, 1);
		assert.strictEqual(byText.get("b")?.bracketDepth, 2);
		assert.strictEqual(byText.get("]")?.bracketDepth, 1);
		assert.strictEqual(byText.get(")")?.parenDepth, 0);
	});
});

suite("gdscript lexer: trivia", () => {
	test("EOL comment is trailing trivia of the last token", () => {
		const tokens = tokenize("x = 1  # note\n");
		const one = tokens.find((t) => t.text === "1");
		assert.isDefined(one);
		assert.deepEqual(
			one?.trailing.map((t) => [t.kind, t.text]),
			[
				["ws", "  "],
				["comment", "# note"],
			],
		);
	});

	test("own-line comment is leading trivia of the next token", () => {
		const tokens = tokenize("# header\nx = 1\n");
		const x = tokens.find((t) => t.text === "x");
		assert.deepEqual(
			x?.leading.map((t) => t.kind),
			["comment", "ws"],
		);
	});

	test("EOL comment without trailing newline", () => {
		const tokens = tokenize("x = 1 # end");
		const one = tokens.find((t) => t.text === "1");
		assert.deepEqual(
			one?.trailing.map((t) => t.kind),
			["ws", "comment"],
		);
		roundtrip("x = 1 # end");
	});
});

suite("gdscript lexer: multiline lambdas", () => {
	test("lambda body inside call gets real line structure", () => {
		const src = "sig.connect(func():\n\tx = 1\n\ty = 2\n)\n";
		const trace = structure(src);
		// newline after header colon is significant; body lines have NL; the
		// closer triggers the dedent
		assert.deepEqual(trace, [
			"sig",
			".",
			"connect",
			"(",
			"func",
			"(",
			")",
			":",
			"NL",
			"IN",
			"x",
			"=",
			"1",
			"NL",
			"y",
			"=",
			"2",
			"NL",
			"DE",
			")",
			"NL",
			"EOF",
		]);
		roundtrip(src);
	});

	test("lambdaDepth marks body tokens", () => {
		const src = "connect(func():\n\tx = 1\n)\n";
		const tokens = sig(src);
		const x = tokens.find((t) => t.text === "x");
		assert.strictEqual(x?.lambdaDepth, 1);
		const connect = tokens.find((t) => t.text === "connect");
		assert.strictEqual(connect?.lambdaDepth, 0);
	});

	test("lambda as non-final argument, ended by comma", () => {
		const src = "call(func():\n\tpass\n, other)\n";
		const trace = structure(src);
		assert.deepEqual(trace, [
			"call",
			"(",
			"func",
			"(",
			")",
			":",
			"NL",
			"IN",
			"pass",
			"NL",
			"DE",
			",",
			"other",
			")",
			"NL",
			"EOF",
		]);
		roundtrip(src);
	});

	test("single-line lambda opens no body block", () => {
		const src = "f(func(): return 1, x)\n";
		assert.deepEqual(structure(src), ["f", "(", "func", "(", ")", ":", "return", "1", ",", "x", ")", "NL", "EOF"]);
	});

	test("named lambda", () => {
		const src = "f(func helper():\n\tpass\n)\n";
		const trace = structure(src);
		assert.include(trace, "IN");
		assert.include(trace, "DE");
		roundtrip(src);
	});

	test("nested lambdas", () => {
		const src = "f(func():\n\tg(func():\n\t\tpass\n\t)\n)\n";
		const tokens = sig(src);
		const pass = tokens.find((t) => t.text === "pass");
		assert.strictEqual(pass?.lambdaDepth, 2);
		roundtrip(src);
	});

	test("brackets inside a lambda body swallow newlines again", () => {
		const src = "f(func():\n\tg(\n\t\ta,\n\t\tb)\n)\n";
		const trace = structure(src);
		assert.deepEqual(trace, [
			"f",
			"(",
			"func",
			"(",
			")",
			":",
			"NL",
			"IN",
			"g",
			"(",
			"a",
			",",
			"b",
			")",
			"NL",
			"DE",
			")",
			"NL",
			"EOF",
		]);
		roundtrip(src);
	});

	test("lambda in dict value", () => {
		const src = 'd = {"cb": func():\n\tpass\n}\n';
		roundtrip(src);
		const tokens = sig(src);
		const pass = tokens.find((t) => t.text === "pass");
		assert.strictEqual(pass?.lambdaDepth, 1);
	});

	test("typed params do not confuse header detection", () => {
		const src = "f(func(a: int, b: Array[int]) -> void:\n\tpass\n)\n";
		const tokens = sig(src);
		const pass = tokens.find((t) => t.text === "pass");
		assert.strictEqual(pass?.lambdaDepth, 1);
		roundtrip(src);
	});

	test("depth-0 lambda uses normal indent machinery", () => {
		const src = "var cb = func():\n\tpass\nvar x = 1\n";
		assert.deepEqual(structure(src), [
			"var",
			"cb",
			"=",
			"func",
			"(",
			")",
			":",
			"NL",
			"IN",
			"pass",
			"NL",
			"DE",
			"var",
			"x",
			"=",
			"1",
			"NL",
			"EOF",
		]);
	});
});

suite("gdscript lexer: round-trip properties", () => {
	test("assorted snippets", () => {
		const snippets = [
			"",
			"\n",
			"# only a comment",
			"   \n\t\n",
			"x=1;y=2\n",
			"@tool\nextends Node2D\n\nfunc _ready():\n\tpass # done\n",
			"var a = $B/%C\nvar d = %E\n",
			'var s = """\nmulti\nline\n"""\n',
			"match x:\n\t1:\n\t\tpass\n\t_:\n\t\tpass\n",
			"export(int) var speed setget set_speed\n",
			"x = a if b else c\n",
			"signal hit(damage)\n",
			"var x := [1, 2,\n\t3]\n",
			"func f(\n\ta := 1,\n\tb := 2,\n):\n\treturn a + b\n",
		];
		for (const s of snippets) {
			roundtrip(s);
		}
	});

	test("corpus: formatter snapshots + test projects", function () {
		this.timeout(10000);
		const root = path.resolve(__dirname, "..", "..", "..");
		const dirs = [path.join(root, "src", "formatter", "snapshots"), path.join(root, "test_projects")];
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
				} else if (entry.name.endsWith(".gd")) {
					files.push(full);
				}
			}
		};
		for (const dir of dirs) {
			walk(dir);
		}
		assert.isAbove(files.length, 40, "corpus should not be empty");
		for (const file of files) {
			const source = fs.readFileSync(file, "utf8");
			const tokens = tokenize(source);
			assert.strictEqual(reconstruct(tokens), source, `round-trip failed: ${path.relative(root, file)}`);
		}
	});
});
