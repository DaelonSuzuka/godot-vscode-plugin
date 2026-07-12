// GDScript formatter engine v2 — vscode-free, string → string.
//
// Line-preserving formatter driven by the union lexer's honest tokens instead
// of TextMate scopes. Behavior is a faithful port of v1 (src/formatter/
// textmate.ts) including its quirks, pinned by the shared snapshot corpus;
// see lode/plans/formatter-v2.md.
//
// Contracts (inherited from v1):
// - never merges or splits logical lines; only rewrites within lines and
//   deletes blank lines
// - comment-only lines, merge-conflict markers, and string interiors are
//   preserved byte-for-byte
// - indentation is preserved verbatim (style and depth)
// - leading blank lines deleted; interior runs capped at maxEmptyLines
//   (0 right after a block-opening `:`); trailing blank lines deleted
// New in v2: a line containing an ERROR token is preserved verbatim rather
// than formatted from garbage.

import { Lexer } from "../lexer/lexer";
import { type Token, TokenKind } from "../lexer/tokens";

export interface FormatterOptions {
	maxEmptyLines: number;
	denseFunctionParameters: boolean;
	spacesBeforeEndOfLineComment: 1 | 2;
}

export const defaultOptions: FormatterOptions = {
	maxEmptyLines: 2,
	denseFunctionParameters: false,
	spacesBeforeEndOfLineComment: 1,
};

/** v1's `symbols` list, verbatim — membership defines type "symbol" for
 * spacing purposes. Notably absent: `=`, `!`, `~` (explicit rules instead). */
const SYMBOLS = new Set([
	"**",
	"<<",
	">>",
	"==",
	"!=",
	">=",
	"<=",
	"&&",
	"||",
	"+=",
	"-=",
	"*=",
	"/=",
	"%=",
	"**=",
	"&=",
	"^=",
	"|=",
	"~=",
	"<<=",
	">>=",
	":=",
	"->",
	"&",
	"|",
	"^",
	"-",
	"+",
	"/",
	"*",
	">",
	"<",
	"%",
]);

/** v1 constants (scope constant.language) — spacing type "constant" (inert). */
const CONSTANTS = new Set(["true", "false", "null", "PI", "TAU", "INF", "NAN"]);

interface STok {
	token: Token;
	text: string;
	/** v1-equivalent spacing type */
	type: "keyword" | "symbol" | "constant" | "variable" | "nodepath" | "none";
	/** v1 `skip` flag (nodepath-ish, preserve internals) */
	skip: boolean;
	/** v1 `identifier` flag: /[A-Za-z_]\w/ somewhere in the text (2+ chars) */
	identifier: boolean;
	/** v1 `string` flag */
	string: boolean;
	/** inside a (...) list — v1 `param` */
	param: boolean;
	/** inside a multiline lambda body — v1 `inLambdaBody` */
	inLambdaBody: boolean;
}

function classify(token: Token): STok {
	const text = token.text;
	const s: STok = {
		token,
		text,
		type: "none",
		skip: false,
		identifier: /[A-Za-z_]\w/.test(text),
		string: false,
		param: token.parenDepth > 0,
		inLambdaBody: token.lambdaDepth > 0,
	};
	switch (token.kind) {
		case TokenKind.Keyword:
			if (text === "self" || text === "super") {
				s.type = "variable";
			} else if (text === "signal") {
				// keyword in declarations, value reference in expressions
				s.type = token.statementStart ? "keyword" : "variable";
			} else if (text === "preload") {
				s.type = "none"; // behaves like a function call
			} else if (CONSTANTS.has(text)) {
				s.type = "constant";
			} else {
				s.type = "keyword";
			}
			break;
		case TokenKind.Identifier:
			s.type = "variable";
			break;
		case TokenKind.Operator:
		case TokenKind.Arrow:
		case TokenKind.InferAssign:
			s.type = SYMBOLS.has(text) ? "symbol" : "none";
			break;
		case TokenKind.NodePath:
		case TokenKind.UniqueNode:
			s.type = "nodepath";
			s.skip = true;
			break;
		case TokenKind.NodePathString:
			s.type = "nodepath";
			s.skip = true;
			s.string = true;
			break;
		case TokenKind.String:
		case TokenKind.StringName:
			s.string = true;
			break;
		default:
			break;
	}
	return s;
}

/** does this token end an expression (an operator after it would be binary)? */
function can_end_expression(s: STok): boolean {
	switch (s.token.kind) {
		case TokenKind.Identifier:
		case TokenKind.Number:
		case TokenKind.String:
		case TokenKind.StringName:
		case TokenKind.NodePathString:
		case TokenKind.NodePath:
		case TokenKind.UniqueNode:
		case TokenKind.ParenClose:
		case TokenKind.BracketClose:
		case TokenKind.BraceClose:
			return true;
		case TokenKind.Keyword:
			return s.type === "variable" || s.type === "constant";
		default:
			return false;
	}
}

/**
 * Spacing before tokens[i] — the v1 `between()` cascade transcribed onto
 * lexer tokens. Order is behavior; comments cite the v1 rule where the
 * correspondence isn't obvious.
 */
function between(tokens: STok[], i: number, options: FormatterOptions): string {
	const cur = tokens[i];
	const prev = tokens[i - 1];
	if (!prev) {
		return "";
	}
	const next = cur.text;
	const p = prev.text;

	if (prev.skip && cur.skip) return "";

	if (p === "(") return "";
	if (p === "." || p === "..") {
		return cur.type === "symbol" ? " " : "";
	}
	if (next === "." || next === "..") return "";

	// dense parameter block (v1: param scope, lambda bodies exempt)
	if (cur.param && !cur.inLambdaBody && !prev.inLambdaBody) {
		if (options.denseFunctionParameters) {
			if (p === "-" || p === "+") {
				const pp = tokens[i - 2];
				if (pp?.text === "=") return "";
				if (pp?.type === "keyword" || pp?.type === "symbol") return "";
				if (pp?.text === "," || pp?.text === "(") return "";
			}
			if (next === "%") return " ";
			if (p === "%") return " ";
			if (next === "=") {
				if (tokens[i - 2]?.text === ":") return " ";
				return "";
			}
			if (p === "=") {
				if (tokens[i - 3]?.text === ":") return " ";
				return "";
			}
			if (next === ":=") return ""; // v1: ':' with no dense rule, then '=' packed
			if (p === ":=") return "";
			if (prev.type === "symbol") return " ";
			if (cur.type === "symbol" && next !== ":=") return " ";
		} else {
			// v1 non-dense: `x := 1` keeps the space before ':='
			if (next === ":" && tokens[i + 1]?.text === "=") return " ";
		}
	}

	if (next === ":") {
		// typed declaration: `var x: int` / `var x: int = 1`
		if (tokens[i - 2]?.text === "var" || tokens[i - 2]?.text === "const") {
			if (tokens[i + 1]?.text !== "=") return "";
			return " ";
		}
		if (prev.type === "keyword") return "";
	}
	// single-token `:=` — v1 saw ':' + '=' and spaced before ':' in
	// declarations (rule at 194/200); dense-param case handled above
	if (next === ":=") return " ";
	// spaced `: =` condenses to `:=` (v1 rule 224)
	if (p === ":" && next === "=") return "";

	if (p === "-" || p === "+") {
		if (next === "(") return " "; // v1 quirk: always a space here
		const pp = tokens[i - 2];
		if (pp?.type === "keyword" || pp?.type === "symbol") return "";
		if (pp?.text === "," || pp?.text === "(" || pp?.text === "[") return "";
		if (pp?.text === "=") return "";
		if (cur.identifier) return " ";
		if (i === 1) return "";
	}

	if (next === "(") {
		if (p === "export" || p === "func" || p === "assert" || p === "yield") return "";
		if (prev.token.kind === TokenKind.Annotation) return ""; // @export_range(...)
	}

	if (p === ")" && cur.type === "keyword") return " ";

	if (p === "[" && (cur.type === "symbol" || cur.type === "nodepath")) return "";
	if (p === ":") return " ";
	if (p === ";") return " ";
	if (next === "=") return " ";
	if (p === "=" || p === ":=") return " ";
	if (tokens[i - 2]?.text === "=" && (p === "+" || p === "-")) return "";
	if (next === "{") return " ";

	if (prev.type === "keyword") return " ";
	if (cur.type === "keyword") return " ";
	if (prev.type === "symbol") return " ";
	if (cur.type === "symbol") return " ";

	// annotations are single fused tokens here (v1 saw '@' + keyword)
	if (cur.token.kind === TokenKind.Annotation) return " ";
	if (prev.token.kind === TokenKind.Annotation) return " ";

	if (p === ",") return " ";

	return "";
}

/** v1 comment normalization: '#'/'##' punctuation + single space + content */
function normalize_comment(text: string): string {
	const m = text.match(/^(#+)[ \t]*(.*)$/);
	if (!m) {
		return text;
	}
	const rest = m[2].trimEnd();
	return rest.length > 0 ? `${m[1]} ${rest}` : m[1];
}

interface Line {
	text: string;
	/** line was followed by \n in the source */
	newline: boolean;
	deleted: boolean;
}

export function format_source(source: string, options: FormatterOptions = defaultOptions): string {
	const tokens = new Lexer(source).tokenize();

	// significant tokens grouped by starting line
	const byLine = new Map<number, STok[]>();
	// lines covered by the interior/tail of a multi-line token
	const spanned = new Set<number>();
	const errorLines = new Set<number>();
	for (const t of tokens) {
		switch (t.kind) {
			case TokenKind.Newline:
			case TokenKind.Indent:
			case TokenKind.Dedent:
			case TokenKind.EOF:
				continue;
			default:
				break;
		}
		if (t.kind === TokenKind.Error) {
			for (let l = t.start.line; l <= t.end.line; l++) {
				errorLines.add(l);
			}
		}
		let group = byLine.get(t.start.line);
		if (!group) {
			group = [];
			byLine.set(t.start.line, group);
		}
		group.push(classify(t));
		for (let l = t.start.line + 1; l <= t.end.line; l++) {
			spanned.add(l);
		}
	}

	const raw = source.split("\n");
	const lines: Line[] = raw.map((text, i) => ({
		text,
		newline: i < raw.length - 1,
		deleted: false,
	}));

	let lastToken = "";
	let onlyEmptyLinesSoFar = true;
	const pendingEmpty: number[] = [];

	const flush_empty_run = () => {
		const cap = lastToken === ":" ? 0 : options.maxEmptyLines;
		// v1 keeps the first `cap` blank lines of a run, deletes the rest
		for (let j = cap; j < pendingEmpty.length; j++) {
			lines[pendingEmpty[j]].deleted = true;
		}
		pendingEmpty.length = 0;
	};

	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		if (spanned.has(n)) {
			// interior/tail of a multi-line string token: preserved via the
			// token text emitted on its starting line
			line.deleted = true;
			continue;
		}

		if (line.text.trim() === "") {
			if (onlyEmptyLinesSoFar) {
				line.deleted = true; // leading blank lines
			} else {
				pendingEmpty.push(n);
			}
			continue;
		}
		onlyEmptyLinesSoFar = false;
		flush_empty_run();

		const trimmed = line.text.trimStart();
		if (trimmed.startsWith("#")) {
			continue; // comment-only line: verbatim
		}
		if (trimmed.startsWith("<<<<<<<") || trimmed.startsWith("=======") || trimmed.startsWith(">>>>>>>")) {
			continue; // merge conflict marker: verbatim
		}
		if (errorLines.has(n)) {
			continue; // unlexable content: verbatim (v2 safety)
		}

		const group = byLine.get(n);
		if (!group || group.length === 0) {
			continue;
		}

		// nodepath chains split by spaces (`$A / B / %C`) — v1's grammar
		// scoped the whole chain as skip tokens, joining them tight; propagate
		// skip through `/` links so the same happens here
		for (let i = 1; i < group.length; i++) {
			const a = group[i - 1];
			const b = group[i];
			// a path link is a bare `/` or a path token ending in `/`
			// (e.g. `$Child/   GrandChild` lexes as `$Child/` + identifier)
			if (a.skip && (b.text === "/" || a.text.endsWith("/"))) {
				b.skip = true;
			}
		}

		const indent = line.text.slice(0, line.text.length - trimmed.length);
		let out = indent;
		for (let i = 0; i < group.length; i++) {
			if (i > 0 && group[i - 1].string && group[i].string) {
				// v1: adjacent string fragments keep their original gap
				out += group[i].token.leading.map((tr) => tr.text).join("");
			} else {
				out += between(group, i, options);
			}
			out += group[i].text;
		}

		// EOL comment from the last token's trailing trivia
		const last = group[group.length - 1];
		const comment = last.token.trailing.find((tr) => tr.kind === "comment");
		if (comment) {
			out += options.spacesBeforeEndOfLineComment === 2 ? "  " : " ";
			out += normalize_comment(comment.text);
		}

		// line continuation: v1 keeps ` \` at end of line
		if (line.text.trimEnd().endsWith("\\") && !last.text.endsWith("\\")) {
			out += " \\";
		}

		lastToken = last.text;
		line.text = out;
	}
	// trailing blank lines (and any pending run at EOF) are deleted entirely
	for (const j of pendingEmpty) {
		lines[j].deleted = true;
	}

	let result = "";
	for (const line of lines) {
		if (line.deleted) {
			continue;
		}
		result += line.text;
		if (line.newline) {
			result += "\n";
		}
	}
	return result;
}
