// Parser for Godot text resource files (.tscn / .tres) — vscode-free.
//
// Replaces the line-regex approach: this is a real recursive parser for the
// format Godot's ResourceFormatLoaderText + VariantParser define — section
// headers `[tag key=value ...]` followed by `key = value` properties whose
// values are full variant literals (strings with escapes, numbers, arrays,
// dicts, constructor calls like ExtResource("1_a2b") or Vector2(1, 2),
// spanning multiple lines when needed). Regexes cannot see nesting or quoted
// strings, which is why node names with spaces or paths with parentheses
// silently broke before.
//
// Values parse into a small JS tree; unknown constructs are still consumed
// with correct bracket/string balance, so one exotic value never desyncs the
// rest of the file.

export interface TscnCall {
	kind: "call";
	name: string;
	args: TscnValue[];
}

export interface TscnIdent {
	kind: "ident";
	name: string;
}

export type TscnValue =
	| string
	| number
	| boolean
	| null
	| TscnCall
	| TscnIdent
	| TscnValue[]
	| Map<TscnValue, TscnValue>;

export interface TscnSection {
	tag: string;
	attributes: Map<string, TscnValue>;
	properties: Map<string, TscnValue>;
	/** 0-based line of the `[` */
	line: number;
	/** offset of the `[` */
	offset: number;
	/** offset one past the last property of this section */
	endOffset: number;
	/** the header line text, `[...]` inclusive */
	header: string;
}

export interface TscnParseResult {
	sections: TscnSection[];
	/** non-fatal problems encountered (file still parsed) */
	warnings: string[];
}

class ParseError extends Error {}

export class TscnParser {
	private src: string;
	private pos = 0;
	private line = 0;
	private warnings: string[] = [];

	constructor(source: string) {
		this.src = source;
	}

	parse(): TscnParseResult {
		const sections: TscnSection[] = [];
		this.skip_trivia();
		while (this.pos < this.src.length) {
			// hard termination guarantee: every iteration must consume input.
			// A parser gap must become a thrown error, never a hang.
			const before = this.pos;
			if (this.peek() === "[") {
				const section = this.parse_section_header();
				if (sections.length > 0) {
					sections[sections.length - 1].endOffset = section.offset;
				}
				sections.push(section);
			} else {
				// property line; attach to the current section (a stray
				// property before any section is tolerated and dropped)
				const prop = this.parse_property();
				const current = sections[sections.length - 1];
				if (current && prop) {
					current.properties.set(prop.key, prop.value);
				}
			}
			this.skip_trivia();
			if (this.pos === before) {
				throw this.error(`parser made no progress at ${JSON.stringify(this.peek())}`);
			}
		}
		if (sections.length > 0) {
			sections[sections.length - 1].endOffset = this.src.length;
		}
		return { sections, warnings: this.warnings };
	}

	// --- cursor ---

	private peek(offset = 0): string {
		return this.src[this.pos + offset] ?? "";
	}

	private advance(): string {
		const c = this.src[this.pos++];
		if (c === "\n") {
			this.line++;
		}
		return c;
	}

	private skip_ws_inline() {
		while (this.peek() === " " || this.peek() === "\t" || this.peek() === "\r") {
			this.advance();
		}
	}

	/** whitespace, newlines, and `;` comments */
	private skip_trivia() {
		for (;;) {
			const c = this.peek();
			if (c === " " || c === "\t" || c === "\r" || c === "\n") {
				this.advance();
			} else if (c === ";") {
				while (this.pos < this.src.length && this.peek() !== "\n") {
					this.advance();
				}
			} else {
				return;
			}
		}
	}

	private error(message: string): ParseError {
		return new ParseError(`${message} (line ${this.line + 1})`);
	}

	// --- sections ---

	private parse_section_header(): TscnSection {
		const offset = this.pos;
		const line = this.line;
		this.advance(); // [
		this.skip_ws_inline();
		const tag = this.parse_bare_word();
		const attributes = new Map<string, TscnValue>();
		for (;;) {
			this.skip_ws_inline();
			const c = this.peek();
			if (c === "]") {
				this.advance();
				break;
			}
			if (c === "" || c === "\n") {
				throw this.error(`unterminated section header [${tag}`);
			}
			const key = this.parse_key();
			if (key === "") {
				// refuse to loop on a character no rule consumes
				throw this.error(`malformed section header [${tag}: unexpected ${JSON.stringify(c)}`);
			}
			this.skip_ws_inline();
			if (this.peek() === "=") {
				this.advance();
				this.skip_ws_inline();
				attributes.set(key, this.parse_value());
			} else {
				attributes.set(key, true); // bare flag, e.g. [editable path=".."]
			}
		}
		const headerEnd = this.src.indexOf("\n", offset);
		return {
			tag,
			attributes,
			properties: new Map(),
			line,
			offset,
			endOffset: this.src.length,
			header: this.src.slice(offset, headerEnd === -1 ? this.src.length : headerEnd),
		};
	}

	private parse_property(): { key: string; value: TscnValue } | null {
		const key = this.parse_key();
		if (key === "") {
			// unrecognized garbage: consume the line to stay in sync
			this.warnings.push(`skipped unparseable line ${this.line + 1}`);
			while (this.pos < this.src.length && this.peek() !== "\n") {
				this.advance();
			}
			return null;
		}
		this.skip_ws_inline();
		if (this.peek() !== "=") {
			this.warnings.push(`property '${key}' with no value at line ${this.line + 1}`);
			return { key, value: null };
		}
		this.advance();
		this.skip_ws_inline();
		return { key, value: this.parse_value() };
	}

	/** bare (anchors/preset, metadata/_edit_lock_) or quoted property key */
	private parse_key(): string {
		if (this.peek() === '"') {
			return this.parse_string();
		}
		return this.parse_bare_word();
	}

	private parse_bare_word(): string {
		let word = "";
		for (;;) {
			const c = this.peek();
			// ':' appears in TileSet atlas-coordinate keys: 0:0/1/flip_h = true
			if (/[A-Za-z0-9_/.:\-]/.test(c) && c !== "") {
				word += this.advance();
			} else {
				return word;
			}
		}
	}

	// --- values ---

	parse_value(): TscnValue {
		this.skip_trivia();
		const c = this.peek();
		if (c === '"') {
			return this.parse_string();
		}
		if (c === "&" && this.peek(1) === '"') {
			this.advance(); // StringName prefix
			return this.parse_string();
		}
		if (c === "[") {
			return this.parse_array();
		}
		if (c === "{") {
			return this.parse_dict();
		}
		if (c === "-" || (c >= "0" && c <= "9") || (c === "." && /[0-9]/.test(this.peek(1)))) {
			return this.parse_number();
		}
		if (/[A-Za-z_]/.test(c)) {
			return this.parse_ident_or_call();
		}
		throw this.error(`unexpected character ${JSON.stringify(c)} in value`);
	}

	private parse_string(): string {
		this.advance(); // opening "
		let out = "";
		for (;;) {
			if (this.pos >= this.src.length) {
				throw this.error("unterminated string");
			}
			const c = this.advance();
			if (c === '"') {
				return out;
			}
			if (c === "\\") {
				const esc = this.advance();
				switch (esc) {
					case "n":
						out += "\n";
						break;
					case "t":
						out += "\t";
						break;
					case "r":
						out += "\r";
						break;
					case '"':
						out += '"';
						break;
					case "\\":
						out += "\\";
						break;
					case "u": {
						let hex = "";
						for (let i = 0; i < 4; i++) {
							hex += this.advance();
						}
						out += String.fromCharCode(Number.parseInt(hex, 16));
						break;
					}
					default:
						out += esc;
				}
				continue;
			}
			out += c;
		}
	}

	private parse_number(): number {
		let text = "";
		if (this.peek() === "-" || this.peek() === "+") {
			text += this.advance();
		}
		while (/[0-9]/.test(this.peek())) {
			text += this.advance();
		}
		if (this.peek() === ".") {
			text += this.advance();
			while (/[0-9]/.test(this.peek())) {
				text += this.advance();
			}
		}
		if (this.peek() === "e" || this.peek() === "E") {
			text += this.advance();
			if (this.peek() === "-" || this.peek() === "+") {
				text += this.advance();
			}
			while (/[0-9]/.test(this.peek())) {
				text += this.advance();
			}
		}
		return Number.parseFloat(text);
	}

	private parse_ident_or_call(): TscnValue {
		let name = "";
		while (/[A-Za-z0-9_]/.test(this.peek())) {
			name += this.advance();
		}
		this.skip_ws_inline();
		// typed containers (Godot 4.4+): Dictionary[String, Texture]({...}),
		// Array[int]([1, 2]) — consume the bracketed type parameters into the
		// call name; the payload parses as a normal argument
		if (this.peek() === "[" && (name === "Dictionary" || name === "Array")) {
			let depth = 0;
			do {
				const c = this.advance();
				name += c;
				if (c === "[") depth++;
				if (c === "]") depth--;
				if (this.pos >= this.src.length) {
					throw this.error(`unterminated type parameters on ${name}`);
				}
			} while (depth > 0);
			this.skip_ws_inline();
		}
		if (this.peek() === "(") {
			this.advance();
			const args: TscnValue[] = [];
			this.skip_trivia();
			if (this.peek() === ")") {
				this.advance();
				return { kind: "call", name, args };
			}
			for (;;) {
				args.push(this.parse_value());
				this.skip_trivia();
				// embedded objects serialize as Object(ClassName, "prop": value,
				// ...) — key:value pairs as call arguments; consume the pair
				if (this.peek() === ":") {
					this.advance();
					args.push(this.parse_value());
					this.skip_trivia();
				}
				const c = this.advance();
				if (c === ")") {
					return { kind: "call", name, args };
				}
				if (c !== ",") {
					throw this.error(`expected ',' or ')' in ${name}(...)`);
				}
				this.skip_trivia();
			}
		}
		if (name === "true") return true;
		if (name === "false") return false;
		if (name === "null" || name === "nil") return null;
		if (name === "inf") return Number.POSITIVE_INFINITY;
		if (name === "inf_neg") return Number.NEGATIVE_INFINITY;
		if (name === "nan") return Number.NaN;
		return { kind: "ident", name };
	}

	private parse_array(): TscnValue[] {
		this.advance(); // [
		const items: TscnValue[] = [];
		this.skip_trivia();
		if (this.peek() === "]") {
			this.advance();
			return items;
		}
		for (;;) {
			items.push(this.parse_value());
			this.skip_trivia();
			const c = this.advance();
			if (c === "]") {
				return items;
			}
			if (c !== ",") {
				throw this.error("expected ',' or ']' in array");
			}
			this.skip_trivia();
			// tolerate trailing comma
			if (this.peek() === "]") {
				this.advance();
				return items;
			}
		}
	}

	private parse_dict(): Map<TscnValue, TscnValue> {
		this.advance(); // {
		const dict = new Map<TscnValue, TscnValue>();
		this.skip_trivia();
		if (this.peek() === "}") {
			this.advance();
			return dict;
		}
		for (;;) {
			const key = this.parse_value();
			this.skip_trivia();
			const sep = this.advance();
			if (sep !== ":" && sep !== "=") {
				throw this.error("expected ':' or '=' in dictionary");
			}
			dict.set(key, this.parse_value());
			this.skip_trivia();
			const c = this.advance();
			if (c === "}") {
				return dict;
			}
			if (c !== ",") {
				throw this.error("expected ',' or '}' in dictionary");
			}
			this.skip_trivia();
			if (this.peek() === "}") {
				this.advance();
				return dict;
			}
		}
	}
}

export function parse_tscn(source: string): TscnParseResult {
	return new TscnParser(source).parse();
}
