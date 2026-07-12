// GDScript union lexer (GDScript 1 + 2), vscode-free.
//
// Single-pass character-dispatch scanner porting the semantics of Godot's
// gdscript_tokenizer.cpp, with one addition Godot doesn't need: standalone
// multiline-lambda handling. Godot's tokenizer relies on the parser to toggle
// indent processing inside lambda bodies; here we exploit the fact that a
// `func` token while bracketDepth > 0 is unambiguously a lambda header, so the
// lexer can manage the lambda stack itself. See lode/plans/formatter-v2.md.

import { EXPRESSION_END_KEYWORDS, KEYWORDS, OPERATORS, type Pos, type Token, TokenKind, type Trivia } from "./tokens";

interface LambdaContext {
	/** bracketDepth at the `func` keyword; body statements live at this depth */
	entryBracketDepth: number;
	/** indentStack.length when the body block was activated */
	indentHeight: number;
}

const CLOSERS: { [key: string]: TokenKind } = {
	")": TokenKind.ParenClose,
	"]": TokenKind.BracketClose,
	"}": TokenKind.BraceClose,
};
const OPENERS: { [key: string]: TokenKind } = {
	"(": TokenKind.ParenOpen,
	"[": TokenKind.BracketOpen,
	"{": TokenKind.BraceOpen,
};

function is_digit(c: string): boolean {
	return c >= "0" && c <= "9";
}

function is_word_start(c: string): boolean {
	return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c.charCodeAt(0) >= 128;
}

function is_word_char(c: string): boolean {
	return is_word_start(c) || is_digit(c);
}

function is_quote(c: string): boolean {
	return c === '"' || c === "'";
}

export class Lexer {
	private src: string;
	private pos = 0;
	private line = 0;
	private col = 0;

	private tokens: Token[] = [];
	private pending: Trivia[] = [];

	/** raw indentation prefixes; [0] is always "" */
	private indentStack: string[] = [""];
	private brackets: string[] = [];
	private parenCount = 0;

	private lambdaStack: LambdaContext[] = [];
	/** `func` seen inside brackets; waiting for the header's closing `:` */
	private armedLambdas: number[] = []; // entry bracketDepths
	/** header `:` seen; if a newline comes next the body block activates */
	private awaitingLambdaBlock = false;

	/** leading whitespace of the current physical line */
	private lineIndent = "";
	/** true until the first significant token of the current physical line */
	private firstOnLine = true;
	/** a significant token has been emitted on the current logical line */
	private lineHasSignificant = false;
	/** previous emitted token was NEWLINE/INDENT/DEDENT (or file start) */
	private lastWasLineBreak = true;
	/** a backslash continuation is open: the logical line continues across
	 * newlines (and across comment-only lines, per Godot GH-89403) until the
	 * next significant token */
	private pendingContinuation = false;

	constructor(source: string) {
		this.src = source;
	}

	tokenize(): Token[] {
		this.consume_line_indent();
		while (this.pos < this.src.length) {
			const c = this.src[this.pos];

			if (c === " " || c === "\t") {
				this.consume_ws_run();
			} else if (c === "\n" || (c === "\r" && this.src[this.pos + 1] === "\n")) {
				this.handle_newline();
			} else if (c === "\r") {
				// stray CR: treat as whitespace
				this.push_ws(this.advance_text(1));
			} else if (c === "\\" && this.is_newline_at(this.pos + 1)) {
				// line continuation: consume backslash + newline as trivia and
				// suppress indent processing for the next physical line
				let text = this.advance_text(1);
				text += this.consume_newline_text();
				this.push_ws(text);
				this.pendingContinuation = true;
				this.consume_physical_line_start(false);
			} else if (c === "#") {
				this.consume_comment();
			} else {
				this.scan_significant(c);
			}
		}
		this.finish();
		return this.tokens;
	}

	// --- low-level cursor helpers ---

	private peek(offset = 0): string {
		return this.src[this.pos + offset] ?? "";
	}

	private is_newline_at(pos: number): boolean {
		const c = this.src[pos];
		return c === "\n" || (c === "\r" && this.src[pos + 1] === "\n");
	}

	private here(): Pos {
		return { line: this.line, col: this.col, offset: this.pos };
	}

	/** advance n chars (no newlines expected) and return the consumed text */
	private advance_text(n: number): string {
		const text = this.src.slice(this.pos, this.pos + n);
		this.pos += n;
		this.col += n;
		return text;
	}

	/** consume one newline sequence, updating line/col; returns its text */
	private consume_newline_text(): string {
		let text: string;
		if (this.peek() === "\r") {
			text = this.advance_text(0) + this.src.slice(this.pos, this.pos + 2);
			this.pos += 2;
		} else {
			text = this.src[this.pos];
			this.pos += 1;
		}
		this.line += 1;
		this.col = 0;
		return text;
	}

	// --- trivia ---

	private push_ws(text: string, start?: Pos) {
		if (text.length === 0) {
			return;
		}
		const last = this.pending[this.pending.length - 1];
		if (last && last.kind === "ws") {
			last.text += text;
		} else {
			this.pending.push({ kind: "ws", text, start: start ?? this.here() });
		}
	}

	private consume_ws_run() {
		const start = this.here();
		let n = 0;
		while (this.peek(n) === " " || this.peek(n) === "\t") {
			n++;
		}
		this.push_ws(this.advance_text(n), start);
	}

	private consume_comment() {
		const start = this.here();
		let n = 0;
		while (this.pos + n < this.src.length && !this.is_newline_at(this.pos + n) && this.peek(n) !== "\r") {
			n++;
		}
		this.pending.push({ kind: "comment", text: this.advance_text(n), start });
	}

	/** consume the leading whitespace of a fresh physical line */
	private consume_line_indent() {
		let n = 0;
		while (this.peek(n) === " " || this.peek(n) === "\t") {
			n++;
		}
		this.lineIndent = this.src.slice(this.pos, this.pos + n);
		if (n > 0) {
			const start = this.here();
			this.push_ws(this.advance_text(n), start);
		}
		this.firstOnLine = true;
	}

	private consume_physical_line_start(indentSignificant: boolean) {
		this.consume_line_indent();
		if (!indentSignificant) {
			// continuation line: not a fresh statement line
			this.firstOnLine = false;
		}
	}

	// --- newline / indentation ---

	/** true when newlines and indentation are structurally significant here */
	private indent_applies(): boolean {
		if (this.brackets.length === 0) {
			return true;
		}
		const top = this.lambdaStack[this.lambdaStack.length - 1];
		return top !== undefined && this.brackets.length === top.entryBracketDepth;
	}

	private handle_newline() {
		if (this.pendingContinuation) {
			// comment-only/blank line inside an open continuation: the
			// logical line is still going — swallow the newline
			const start = this.here();
			this.push_ws(this.consume_newline_text(), start);
			this.consume_physical_line_start(false);
			return;
		}
		if (this.awaitingLambdaBlock) {
			// `func (...) :` header followed by a newline: the body block starts
			this.awaitingLambdaBlock = false;
			this.lambdaStack.push({
				entryBracketDepth: this.brackets.length,
				indentHeight: this.indentStack.length,
			});
			this.emit_line_end();
			return;
		}
		if (this.indent_applies() && this.lineHasSignificant) {
			this.emit_line_end();
			return;
		}
		// swallowed newline (inside brackets, or blank/comment-only line)
		const start = this.here();
		this.push_ws(this.consume_newline_text(), start);
		this.consume_physical_line_start(true);
	}

	/** emit a NEWLINE token; pending trivia becomes the previous token's trailing */
	private emit_line_end() {
		const prev = this.tokens[this.tokens.length - 1];
		if (prev && this.pending.length > 0) {
			prev.trailing = prev.trailing.concat(this.pending);
			this.pending = [];
		}
		const start = this.here();
		const text = this.consume_newline_text();
		this.push_token(TokenKind.Newline, text, start, this.here(), []);
		this.lastWasLineBreak = true;
		this.lineHasSignificant = false;
		this.consume_physical_line_start(true);
	}

	/** compare the current line's indent against the stack, emitting INDENT/DEDENTs */
	private process_indent() {
		const indent = this.lineIndent;
		let top = this.indentStack[this.indentStack.length - 1];
		if (indent === top) {
			return;
		}
		if (indent.startsWith(top)) {
			this.indentStack.push(indent);
			this.emit_structural(TokenKind.Indent);
			return;
		}
		while (this.indentStack.length > 1 && !indent.startsWith(top)) {
			this.indentStack.pop();
			this.emit_structural(TokenKind.Dedent);
			this.pop_lambdas_below_height();
			top = this.indentStack[this.indentStack.length - 1];
		}
		if (indent !== top && indent.startsWith(top)) {
			// dedent to a level not on the stack (tolerated; the parser will care)
			this.indentStack.push(indent);
			this.emit_structural(TokenKind.Indent);
		}
	}

	private pop_lambdas_below_height() {
		let top = this.lambdaStack[this.lambdaStack.length - 1];
		while (top && this.indentStack.length <= top.indentHeight) {
			this.lambdaStack.pop();
			top = this.lambdaStack[this.lambdaStack.length - 1];
		}
	}

	/** close lambda bodies that a closer/comma just terminated */
	private close_lambdas_for_depth(depthAfter: number) {
		let top = this.lambdaStack[this.lambdaStack.length - 1];
		while (top && depthAfter < top.entryBracketDepth) {
			while (this.indentStack.length > top.indentHeight) {
				this.indentStack.pop();
				this.emit_structural(TokenKind.Dedent);
			}
			this.lambdaStack.pop();
			top = this.lambdaStack[this.lambdaStack.length - 1];
		}
	}

	private emit_structural(kind: TokenKind) {
		const p = this.here();
		this.push_token(kind, "", p, p, []);
		this.lastWasLineBreak = true;
	}

	// --- token emission ---

	private push_token(kind: TokenKind, text: string, start: Pos, end: Pos, leading: Trivia[]) {
		this.tokens.push({
			kind,
			text,
			start,
			end,
			bracketDepth: this.brackets.length,
			parenDepth: this.parenCount,
			lambdaDepth: this.lambdaStack.length,
			statementStart: false,
			leading,
			trailing: [],
		});
	}

	/** emit a significant token whose text is already consumed */
	private emit(kind: TokenKind, text: string, start: Pos) {
		// Indentation is compared only at logical line starts (after an emitted
		// NEWLINE/INDENT/DEDENT). A physical line that merely continues a
		// bracketed expression (its newline was swallowed) is not one, even if
		// a closer just made indentation significant again.
		if (this.firstOnLine && this.lastWasLineBreak && this.indent_applies()) {
			this.process_indent();
		}
		this.firstOnLine = false;

		const leading = this.pending;
		this.pending = [];
		this.push_token(kind, text, start, this.here(), leading);
		const token = this.tokens[this.tokens.length - 1];
		token.statementStart = this.lastWasLineBreak;
		this.lastWasLineBreak = false;
		this.lineHasSignificant = true;
		this.pendingContinuation = false;
		return token;
	}

	// --- significant token scanning ---

	private scan_significant(c: string) {
		const start = this.here();

		if (OPENERS[c]) {
			// single-line lambda check: a token other than newline after the
			// header colon means no indented body
			this.awaitingLambdaBlock = false;
			const kind = OPENERS[c];
			const text = this.advance_text(1);
			this.emit(kind, text, start); // records OUTER depth
			this.brackets.push(c);
			if (c === "(") {
				this.parenCount++;
			}
			return;
		}

		if (CLOSERS[c]) {
			this.awaitingLambdaBlock = false;
			const opener = this.brackets[this.brackets.length - 1];
			this.brackets.pop();
			if (opener === "(") {
				this.parenCount--;
			}
			// disarm lambda headers whose depth vanished
			while (
				this.armedLambdas.length > 0 &&
				this.brackets.length < this.armedLambdas[this.armedLambdas.length - 1]
			) {
				this.armedLambdas.pop();
			}
			this.close_lambdas_for_depth(this.brackets.length);
			const text = this.advance_text(1);
			this.emit(CLOSERS[c], text, start); // records OUTER depth
			return;
		}

		if (c === ",") {
			this.awaitingLambdaBlock = false;
			const top = this.lambdaStack[this.lambdaStack.length - 1];
			if (top && this.brackets.length === top.entryBracketDepth) {
				this.close_lambdas_for_depth(this.brackets.length - 1);
			}
			// a comma also ends any header still waiting for its colon at this
			// depth (e.g. `{"a": func x, ...}` malformed, or `f(func, x)`)
			while (
				this.armedLambdas.length > 0 &&
				this.armedLambdas[this.armedLambdas.length - 1] >= this.brackets.length
			) {
				this.armedLambdas.pop();
			}
			this.emit(TokenKind.Comma, this.advance_text(1), start);
			return;
		}

		if (c === ":") {
			if (this.peek(1) === "=") {
				this.awaitingLambdaBlock = false;
				this.emit(TokenKind.InferAssign, this.advance_text(2), start);
				return;
			}
			const armed = this.armedLambdas[this.armedLambdas.length - 1];
			this.emit(TokenKind.Colon, this.advance_text(1), start);
			if (armed !== undefined && this.brackets.length === armed) {
				this.armedLambdas.pop();
				this.awaitingLambdaBlock = true;
			}
			return;
		}

		if (c === ";") {
			this.awaitingLambdaBlock = false;
			this.emit(TokenKind.Semicolon, this.advance_text(1), start);
			return;
		}

		this.awaitingLambdaBlock = false;

		if (c === ".") {
			if (is_digit(this.peek(1))) {
				this.scan_number(start);
			} else if (this.peek(1) === ".") {
				this.emit(TokenKind.DotDot, this.advance_text(2), start);
			} else {
				this.emit(TokenKind.Dot, this.advance_text(1), start);
			}
			return;
		}

		if (is_digit(c)) {
			this.scan_number(start);
			return;
		}

		if (is_word_start(c)) {
			this.scan_word(start);
			return;
		}

		if (is_quote(c)) {
			this.scan_string(start, "", TokenKind.String, false);
			return;
		}

		if (c === "$") {
			this.scan_node_path(start);
			return;
		}

		if (c === "%") {
			this.scan_percent(start);
			return;
		}

		if (c === "&" && is_quote(this.peek(1))) {
			this.scan_string(start, this.advance_text(1), TokenKind.StringName, false);
			return;
		}

		if (c === "^" && is_quote(this.peek(1))) {
			this.scan_string(start, this.advance_text(1), TokenKind.NodePathString, false);
			return;
		}

		if (c === "@") {
			if (is_quote(this.peek(1))) {
				// Godot 3 NodePath literal: @"Path/To"
				this.scan_string(start, this.advance_text(1), TokenKind.NodePathString, false);
			} else if (is_word_start(this.peek(1))) {
				let n = 1;
				while (is_word_char(this.peek(n))) {
					n++;
				}
				this.emit(TokenKind.Annotation, this.advance_text(n), start);
			} else {
				this.emit(TokenKind.Error, this.advance_text(1), start);
			}
			return;
		}

		if (c === "-" && this.peek(1) === ">") {
			this.emit(TokenKind.Arrow, this.advance_text(2), start);
			return;
		}

		for (const op of OPERATORS) {
			if (this.src.startsWith(op, this.pos)) {
				this.emit(TokenKind.Operator, this.advance_text(op.length), start);
				return;
			}
		}

		this.emit(TokenKind.Error, this.advance_text(1), start);
	}

	private scan_word(start: Pos) {
		let n = 0;
		while (is_word_char(this.peek(n))) {
			n++;
		}
		const word = this.src.slice(this.pos, this.pos + n);

		// raw string prefix: r"..." / r'...'
		if (word === "r" && is_quote(this.peek(1))) {
			this.scan_string(start, this.advance_text(1), TokenKind.String, true);
			return;
		}

		this.advance_text(n);
		if (KEYWORDS.has(word)) {
			const token = this.emit(TokenKind.Keyword, word, start);
			// a lambda header can only occur inside brackets; at depth 0 the
			// normal indent machinery already handles the body
			if (word === "func" && this.brackets.length > 0) {
				this.armedLambdas.push(token.bracketDepth);
			}
		} else {
			this.emit(TokenKind.Identifier, word, start);
		}
	}

	private scan_number(start: Pos) {
		let n = 0;
		const peek = (i: number) => this.peek(n + i);
		if (peek(0) === "0" && (peek(1) === "x" || peek(1) === "X")) {
			n += 2;
			while (/[0-9a-fA-F_]/.test(peek(0))) {
				n++;
			}
		} else if (peek(0) === "0" && (peek(1) === "b" || peek(1) === "B")) {
			n += 2;
			while (peek(0) === "0" || peek(0) === "1" || peek(0) === "_") {
				n++;
			}
		} else {
			while (is_digit(peek(0)) || peek(0) === "_") {
				n++;
			}
			// decimal point (but not the `..` token)
			if (peek(0) === "." && peek(1) !== ".") {
				n++;
				while (is_digit(peek(0)) || peek(0) === "_") {
					n++;
				}
			}
			if (peek(0) === "e" || peek(0) === "E") {
				const sign = peek(1) === "+" || peek(1) === "-" ? 1 : 0;
				if (is_digit(peek(1 + sign))) {
					n += 1 + sign;
					while (is_digit(peek(0)) || peek(0) === "_") {
						n++;
					}
				}
			}
		}
		this.emit(TokenKind.Number, this.advance_text(n), start);
	}

	/**
	 * Scan a quoted string. `prefix` (already consumed) is r/&/^/@; the raw
	 * flag changes escape handling per Godot: in raw strings only \" and \\
	 * consume two characters, any other backslash stays literal.
	 * The token text includes prefix and quotes. Per Godot's tokenizer,
	 * literal newlines are legal inside ANY string (even single-quoted,
	 * even raw) — "unterminated" only exists at EOF.
	 */
	private scan_string(start: Pos, prefix: string, kind: TokenKind, raw: boolean) {
		const quote = this.peek();
		let text = prefix;
		const triple = this.peek(1) === quote && this.peek(2) === quote;
		text += this.advance_text(triple ? 3 : 1);

		for (;;) {
			if (this.pos >= this.src.length) {
				this.emit(TokenKind.Error, text, start);
				return;
			}
			const c = this.peek();
			if (c === "\\") {
				if (raw) {
					const next = this.peek(1);
					text += this.advance_text(next === quote || next === "\\" ? 2 : 1);
				} else if (this.is_newline_at(this.pos + 1)) {
					text += this.advance_text(1) + this.consume_newline_text();
				} else {
					text += this.advance_text(2);
				}
				continue;
			}
			if (this.is_newline_at(this.pos)) {
				text += this.consume_newline_text();
				continue;
			}
			if (c === quote) {
				if (triple) {
					if (this.peek(1) === quote && this.peek(2) === quote) {
						text += this.advance_text(3);
						this.emit(kind, text, start);
						return;
					}
					text += this.advance_text(1);
					continue;
				}
				text += this.advance_text(1);
				this.emit(kind, text, start);
				return;
			}
			text += this.advance_text(1);
		}
	}

	/** $Path/To, $"quoted seg"/Sub, $A/%Unique — one token, like v1's `skip` */
	private scan_node_path(start: Pos) {
		let text = this.advance_text(1); // $
		text += this.scan_path_segments();
		this.emit(TokenKind.NodePath, text, start);
	}

	private scan_path_segments(): string {
		let text = "";
		// absolute paths: $/root/Child
		while (this.peek() === "/") {
			text += this.advance_text(1);
		}
		for (;;) {
			if (this.peek() === "%") {
				text += this.advance_text(1);
			}
			if (is_quote(this.peek())) {
				text += this.consume_quoted_segment();
			} else if (is_word_start(this.peek())) {
				let n = 0;
				while (is_word_char(this.peek(n))) {
					n++;
				}
				text += this.advance_text(n);
			} else {
				break;
			}
			if (this.peek() === "/") {
				text += this.advance_text(1);
			} else {
				break;
			}
		}
		return text;
	}

	private consume_quoted_segment(): string {
		const quote = this.peek();
		let text = this.advance_text(1);
		while (this.pos < this.src.length && !this.is_newline_at(this.pos)) {
			const c = this.peek();
			if (c === "\\" && !this.is_newline_at(this.pos + 1)) {
				text += this.advance_text(2);
				continue;
			}
			text += this.advance_text(1);
			if (c === quote) {
				break;
			}
		}
		return text;
	}

	/** `%` is a unique-node sigil iff the previous significant token cannot
	 * end an expression; otherwise it's the modulo operator. */
	private scan_percent(start: Pos) {
		if (!this.prev_can_end_expression() && (is_word_start(this.peek(1)) || is_quote(this.peek(1)))) {
			let text = this.advance_text(1);
			text += this.scan_path_segments();
			this.emit(TokenKind.UniqueNode, text, start);
			return;
		}
		if (this.peek(1) === "=") {
			this.emit(TokenKind.Operator, this.advance_text(2), start);
		} else {
			this.emit(TokenKind.Operator, this.advance_text(1), start);
		}
	}

	private prev_can_end_expression(): boolean {
		for (let i = this.tokens.length - 1; i >= 0; i--) {
			const t = this.tokens[i];
			switch (t.kind) {
				case TokenKind.Newline:
				case TokenKind.Indent:
				case TokenKind.Dedent:
					continue;
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
					return EXPRESSION_END_KEYWORDS.has(t.text);
				default:
					return false;
			}
		}
		return false;
	}

	// --- end of file ---

	private finish() {
		// same-line trailing trivia (no newline yet) belongs to the last token
		const prev = this.tokens[this.tokens.length - 1];
		if (prev && this.pending.length > 0) {
			const trailing: Trivia[] = [];
			while (this.pending.length > 0) {
				const piece = this.pending[0];
				if (piece.kind === "comment") {
					trailing.push(this.pending.shift() as Trivia);
					continue;
				}
				const nl = piece.text.indexOf("\n");
				if (nl === -1) {
					trailing.push(this.pending.shift() as Trivia);
					continue;
				}
				const cut = piece.text[nl - 1] === "\r" ? nl - 1 : nl;
				if (cut > 0) {
					trailing.push({ kind: "ws", text: piece.text.slice(0, cut), start: piece.start });
					piece.text = piece.text.slice(cut);
					piece.start = { ...piece.start, col: piece.start.col + cut, offset: piece.start.offset + cut };
				}
				break;
			}
			prev.trailing = prev.trailing.concat(trailing);
		}

		// balance the blocks
		this.lambdaStack = [];
		while (this.indentStack.length > 1) {
			this.indentStack.pop();
			this.emit_structural(TokenKind.Dedent);
		}

		const p = this.here();
		const leading = this.pending;
		this.pending = [];
		this.push_token(TokenKind.EOF, "", p, p, leading);
	}
}

/** Tokenize GDScript source (either dialect). Never throws: unlexable input
 * becomes ERROR tokens and the stream is still lossless. */
export function tokenize(source: string): Token[] {
	return new Lexer(source).tokenize();
}
