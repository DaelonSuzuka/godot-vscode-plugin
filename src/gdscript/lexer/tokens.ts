// GDScript lexer token model.
//
// This module is part of the vscode-free zone (src/gdscript/**): it must run
// under plain node with no extension-host dependencies.
//
// Losslessness contract: for a token stream produced by tokenize(), the
// concatenation of every token's leading trivia text, token text, and trailing
// trivia text — in stream order — reproduces the source byte-for-byte.
// (NEWLINE tokens carry their newline characters; INDENT/DEDENT/EOF are
// zero-width; all other inter-token text lives in trivia.)

export enum TokenKind {
	// Structural (synthesized)
	Newline = "newline", // end of a logical line; text is "\n" or "\r\n"
	Indent = "indent", // zero-width; indentation increased
	Dedent = "dedent", // zero-width; indentation decreased
	EOF = "eof", // zero-width; carries trailing trivia of the file
	Error = "error", // unterminated string, alien character, etc.

	// Words
	Identifier = "identifier",
	Keyword = "keyword", // union of GDScript 1 + 2 keywords and word operators
	Annotation = "annotation", // @export, @rpc, ... (one token including '@')

	// Literals
	Number = "number",
	String = "string", // includes prefix and quotes, e.g. r"x", """x"""
	StringName = "string_name", // &"name"
	NodePathString = "node_path_string", // ^"path" (Godot 4) or @"path" (Godot 3)
	NodePath = "node_path", // $Path/To or $"a b"/c
	UniqueNode = "unique_node", // %Name or %"name"

	// Punctuation
	ParenOpen = "paren_open",
	ParenClose = "paren_close",
	BracketOpen = "bracket_open",
	BracketClose = "bracket_close",
	BraceOpen = "brace_open",
	BraceClose = "brace_close",
	Comma = "comma",
	Colon = "colon",
	Semicolon = "semicolon",
	Dot = "dot",
	DotDot = "dot_dot", // .. (open-ended match pattern)
	Arrow = "arrow", // ->
	InferAssign = "infer_assign", // :=
	Operator = "operator", // everything else: + - * == and so on
}

export interface Pos {
	/** 0-based line */
	line: number;
	/** 0-based column (UTF-16 code units, matching VS Code semantics) */
	col: number;
	/** absolute offset in the source string */
	offset: number;
}

export type TriviaKind = "ws" | "comment";

export interface Trivia {
	kind: TriviaKind;
	/** exact source text: whitespace runs (possibly containing swallowed
	 * newlines and line continuations) or a single # comment (no newline) */
	text: string;
	start: Pos;
}

export interface Token {
	kind: TokenKind;
	/** exact source slice; empty for Indent/Dedent/EOF */
	text: string;
	start: Pos;
	end: Pos;

	// Context annotations — the honest flags the formatter needs.
	/** depth counting all of ( [ {. Open/close tokens carry the OUTER depth;
	 * everything between them carries the inner depth. */
	bracketDepth: number;
	/** depth counting only parentheses, same outer/inner convention.
	 * This is the precise "inside a parameter/argument list" signal. */
	parenDepth: number;
	/** number of enclosing multiline lambda bodies (0 = none) */
	lambdaDepth: number;
	/** true for the first significant token of a logical line */
	statementStart: boolean;

	leading: Trivia[];
	trailing: Trivia[];
}

/** Union keyword table: GDScript 1 (Godot 3) + GDScript 2 (Godot 4).
 * Word operators (and/or/not/in/is/as) are keywords, as in Godot's tokenizer. */
export const KEYWORDS: ReadonlySet<string> = new Set([
	// shared / GDScript 2 (from godot master gdscript_tokenizer.cpp)
	"and",
	"as",
	"assert",
	"await",
	"break",
	"breakpoint",
	"class",
	"class_name",
	"const",
	"continue",
	"elif",
	"else",
	"enum",
	"extends",
	"for",
	"func",
	"if",
	"in",
	"is",
	"match",
	"namespace",
	"not",
	"or",
	"pass",
	"preload",
	"return",
	"self",
	"signal",
	"static",
	"super",
	"trait",
	"var",
	"void",
	"while",
	"when",
	"yield",
	// literal-ish constants
	"true",
	"false",
	"null",
	"PI",
	"TAU",
	"INF",
	"NAN",
	// GDScript 1 only (Godot 3)
	"export",
	"onready",
	"setget",
	"tool",
	"remote",
	"master",
	"puppet",
	"sync",
	"slave",
	"remotesync",
	"mastersync",
	"puppetsync",
]);

/** Keywords that can end an expression (relevant for %Unique vs modulo). */
export const EXPRESSION_END_KEYWORDS: ReadonlySet<string> = new Set([
	"self",
	"super",
	"true",
	"false",
	"null",
	"PI",
	"TAU",
	"INF",
	"NAN",
]);

/** Multi-character operators, longest first (matching order matters). */
export const OPERATORS: readonly string[] = [
	"**=",
	"<<=",
	">>=",
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
	"&=",
	"^=",
	"|=",
	"~=",
	"=",
	"+",
	"-",
	"*",
	"/",
	"%",
	"&",
	"|",
	"^",
	"~",
	"<",
	">",
	"!",
];
